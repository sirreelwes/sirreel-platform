"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CopyIntakeLinkButton } from "@/components/intake/CopyIntakeLinkButton";
import {
  ORDER_STATUSES,
  ORDER_STATE_CHIP,
  ORDER_STATE_LABEL,
  LOST_REASON_CHOICES,
  LOST_REASON_LABEL,
  deriveOrderListState,
} from "@/lib/orders/listStatus";
import type { LostReason } from "@prisma/client";

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  quoteStatus: string;
  description: string | null;
  subtotal: string;
  total: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  quoteSentAt: string | null;
  sentAt: string | null;
  lostAt: string | null;
  lostReason: LostReason | null;
  archivedAt: string | null;
  company: { id: string; name: string };
  agent: { id: string; name: string };
  job: { id: string; jobCode: string; name: string } | null;
  booking: { id: string; bookingNumber: string; jobName: string } | null;
  _count: { lineItems: number; invoices: number };
};

// `__archived` is a VIEW, not a status — archived orders keep whatever
// lifecycle status they had. It rides in the same select because "show me
// the archived ones" is the same gesture as "show me the cancelled ones"
// from the rep's side, and a second control for one option is clutter.
const ARCHIVED_VIEW = "__archived";

const SORTS = [
  { value: "recent",  label: "Newest first" },
  { value: "pickup",  label: "Pickup date" },
  { value: "value",   label: "Value (high → low)" },
  { value: "company", label: "Company (A → Z)" },
];

const DAY = 86_400_000;

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [valueTotal, setValueTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  // Draft hygiene (order consolidation Phase A): hide DRAFT rows by
  // default so abandoned parses don't clutter the operational list.
  // Toggle reveals them; an explicit status=DRAFT filter overrides
  // either way (the API gives the rep what they asked for).
  const [showDrafts, setShowDrafts] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<Order | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search box. It used to fire a request per keystroke, and
  // nothing ordered the responses — a slow early request could land after a
  // later one and repaint the table with results for a prefix the rep had
  // already typed past.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const reqSeq = useRef(0);
  const archivedView = statusFilter === ARCHIVED_VIEW;

  const fetchOrders = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (statusFilter === ARCHIVED_VIEW) params.set("archived", "1");
    else if (statusFilter) params.set("status", statusFilter);
    if (showDrafts) params.set("includeDrafts", "1");
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("limit", "25");

    try {
      const res = await fetch(`/api/orders?${params}`);
      const data = await res.json();
      // Stale-response guard — only the newest request may paint.
      if (seq !== reqSeq.current) return;
      setOrders(data.orders || []);
      setTotal(data.total || 0);
      setValueTotal(Number(data.valueTotal || 0));
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [debouncedSearch, statusFilter, sort, page, showDrafts]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Close the row menu on any outside click. Without this the menu sticks
  // open while the rep clicks elsewhere on a table whose rows are links.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

  const fmtCents = (n: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;

  async function act(order: Order, path: string, body?: unknown) {
    setBusyId(order.id);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.reason || data.error || `Request failed (${res.status})`);
        return false;
      }
      await fetchOrders();
      return true;
    } finally {
      setBusyId(null);
      setMenuFor(null);
    }
  }

  return (
    // Light-motif page bg — overrides the shell's default so this
    // page reads as the same surface as Jobs and Order detail.
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1500px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-lt-fg">Orders</h1>
            <p className="text-sm text-lt-fg2 mt-1">
              {total} order{total !== 1 ? "s" : ""}
              {total > 0 && (
                <>
                  {" · "}
                  <span className="font-mono text-lt-fg">{fmt(valueTotal)}</span>
                  <span className="text-lt-fg3"> total</span>
                </>
              )}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <CopyIntakeLinkButton />
            <button
              onClick={() => router.push("/orders/new")}
              className="px-4 py-2 bg-lt-fg hover:bg-black text-white text-sm font-medium rounded-lg transition-colors"
            >
              ✨ New Order
            </button>
          </div>
        </div>

        <div className="flex gap-3 mb-4 items-center flex-wrap">
          <input
            type="text"
            placeholder="Search order #, company, production..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-sm px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg focus:outline-none focus:border-lt-fg2"
          >
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{ORDER_STATE_LABEL[s]}</option>
            ))}
            <option value="LOST">Lost</option>
            <option value={ARCHIVED_VIEW}>— Archived —</option>
          </select>
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg focus:outline-none focus:border-lt-fg2"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-lt-fg2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDrafts}
              onChange={(e) => { setShowDrafts(e.target.checked); setPage(1); }}
              className="h-3.5 w-3.5"
            />
            Show drafts
          </label>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-chip-bad-bg text-chip-bad-fg text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-xs underline">Dismiss</button>
          </div>
        )}

        <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lt-hairline text-lt-fg3 text-left text-[10px] font-semibold uppercase tracking-wider bg-lt-inner">
                <th className="px-4 py-3">Order #</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Production</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-center">Items</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-2 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-lt-fg3">Loading...</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-lt-fg3">
                    {archivedView
                      ? "Nothing archived."
                      : debouncedSearch || statusFilter
                        ? "No orders match this filter."
                        : "No orders yet."}
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const state = deriveOrderListState(order);
                  const production =
                    order.description || order.job?.name || order.booking?.jobName || null;
                  const start = fmtDate(order.startDate);
                  const end = fmtDate(order.endDate);
                  const sentAt = order.quoteSentAt || order.sentAt;
                  const ageDays =
                    state === "QUOTE_SENT" && sentAt
                      ? Math.floor((Date.now() - new Date(sentAt).getTime()) / DAY)
                      : null;

                  return (
                    <tr
                      key={order.id}
                      onClick={() => router.push(`/orders/${order.id}`)}
                      className={`border-b border-lt-hairline last:border-b-0 hover:bg-lt-inner cursor-pointer transition-colors ${busyId === order.id ? "opacity-50" : ""}`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-lt-fg3">{order.orderNumber}</span>
                        {order.archivedAt && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border border-chip-muted-border text-chip-muted-fg">
                            Arch
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-lt-fg font-medium">{order.company.name}</td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <div className="truncate text-lt-fg2">{production || "--"}</div>
                        {order.job && (
                          <div className="font-mono text-[10px] text-lt-fg3">{order.job.jobCode}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${ORDER_STATE_CHIP[state]}`}>
                          {ORDER_STATE_LABEL[state]}
                        </span>
                        {state === "LOST" && order.lostReason && (
                          <div className="text-[10px] text-lt-fg3 mt-1">
                            {LOST_REASON_LABEL[order.lostReason]}
                          </div>
                        )}
                        {/* Quote age. A quote sent three weeks ago and one sent
                            this morning were the same pill; the number is the
                            whole reason a rep opens this list. */}
                        {ageDays !== null && (
                          <div className={`text-[10px] mt-1 ${ageDays >= 14 ? "text-chip-bad-fg font-semibold" : ageDays >= 7 ? "text-chip-warn-fg" : "text-lt-fg3"}`}>
                            sent {ageDays === 0 ? "today" : `${ageDays}d ago`}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-lt-fg2 whitespace-nowrap">
                        {start ? `${start} - ${end ?? "?"}` : <span className="text-lt-fg3">No dates</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-lt-fg font-mono whitespace-nowrap">
                        {fmtCents(order.total)}
                      </td>
                      <td className="px-4 py-3 text-center text-lt-fg2">{order._count.lineItems}</td>
                      <td className="px-4 py-3 text-lt-fg2 whitespace-nowrap">{order.agent.name}</td>
                      <td className="px-2 py-3 text-right relative">
                        <button
                          aria-label={`Actions for ${order.orderNumber}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuFor(menuFor === order.id ? null : order.id);
                          }}
                          className="px-2 py-1 rounded text-lt-fg3 hover:text-lt-fg hover:bg-lt-inner2 leading-none"
                        >
                          ⋯
                        </button>
                        {menuFor === order.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-2 top-9 z-20 w-56 bg-lt-card border border-lt-hairline rounded-lg shadow-lg py-1 text-left"
                          >
                            <MenuItem onClick={() => router.push(`/orders/${order.id}`)}>
                              Open order
                            </MenuItem>

                            {state === "LOST" ? (
                              <MenuItem onClick={() => act(order, `/api/orders/${order.id}/mark-lost?undo=1`)}>
                                Reopen quote
                                <Hint>Clears the lost mark and restarts follow-up</Hint>
                              </MenuItem>
                            ) : order.quoteStatus !== "WON" ? (
                              <MenuItem onClick={() => { setMenuFor(null); setLostFor(order); }}>
                                Mark lost…
                                <Hint>Records why; stops follow-up emails</Hint>
                              </MenuItem>
                            ) : (
                              <div className="px-3 py-2 text-xs text-lt-fg3">
                                Won orders can&apos;t be marked lost — cancel from the order page.
                              </div>
                            )}

                            {order.archivedAt ? (
                              <MenuItem onClick={() => act(order, `/api/orders/${order.id}/archive?undo=1`)}>
                                Unarchive
                                <Hint>Returns it to the active list</Hint>
                              </MenuItem>
                            ) : (
                              <MenuItem onClick={() => act(order, `/api/orders/${order.id}/archive`)}>
                                Archive
                                <Hint>Hides it here; the order stays reachable</Hint>
                              </MenuItem>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {total > 25 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-lt-fg2">
              Page {page} of {Math.ceil(total / 25)}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-lt-card border border-lt-hairline rounded text-sm text-lt-fg2 hover:bg-lt-inner disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= Math.ceil(total / 25)}
                className="px-3 py-1 bg-lt-card border border-lt-hairline rounded text-sm text-lt-fg2 hover:bg-lt-inner disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {lostFor && (
        <MarkLostModal
          order={lostFor}
          onClose={() => setLostFor(null)}
          onConfirm={async (reason, note) => {
            const ok = await act(lostFor, `/api/orders/${lostFor.id}/mark-lost`, { reason, note });
            if (ok) setLostFor(null);
          }}
        />
      )}
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-sm text-lt-fg hover:bg-lt-inner transition-colors"
    >
      {children}
    </button>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="block text-[10px] text-lt-fg3 font-normal mt-0.5">{children}</span>;
}

/**
 * Reason is REQUIRED. A lost quote with no reason is a row nobody can learn
 * anything from later — the whole value of classifying it is the reason, and
 * "why did we lose these" is the report this list should eventually feed.
 */
function MarkLostModal({
  order,
  onClose,
  onConfirm,
}: {
  order: Order;
  onClose: () => void;
  onConfirm: (reason: LostReason, note: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState<LostReason | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const value = useMemo(
    () => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(order.total)),
    [order.total],
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-lt-card border border-lt-hairline rounded-xl w-full max-w-md p-5"
      >
        <h2 className="text-lg font-semibold text-lt-fg">Mark this quote lost</h2>
        <p className="text-sm text-lt-fg2 mt-1">
          <span className="font-mono">{order.orderNumber}</span> · {order.company.name} · {value}
        </p>
        <p className="text-xs text-lt-fg3 mt-2">
          Follow-up emails stop. The order stays on the job and can be reopened.
        </p>

        <div className="mt-4 space-y-1">
          {LOST_REASON_CHOICES.map((c) => (
            <label
              key={c.value}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm ${reason === c.value ? "bg-lt-inner text-lt-fg" : "text-lt-fg2 hover:bg-lt-inner2"}`}
            >
              <input
                type="radio"
                name="lost-reason"
                checked={reason === c.value}
                onChange={() => setReason(c.value)}
                className="h-3.5 w-3.5"
              />
              {c.label}
            </label>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (appended to the order's notes)"
          rows={2}
          className="mt-3 w-full px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2"
        />

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-2 text-sm text-lt-fg2 hover:text-lt-fg">
            Cancel
          </button>
          <button
            disabled={!reason || saving}
            onClick={async () => {
              if (!reason) return;
              setSaving(true);
              try {
                await onConfirm(reason, note);
              } finally {
                setSaving(false);
              }
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-chip-bad-fg text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Marking…" : "Mark lost"}
          </button>
        </div>
      </div>
    </div>
  );
}
