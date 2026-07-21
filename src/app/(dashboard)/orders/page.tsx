"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CopyIntakeLinkButton } from "@/components/intake/CopyIntakeLinkButton";

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  description: string | null;
  subtotal: string;
  total: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  company: { id: string; name: string };
  agent: { id: string; name: string };
  booking: { id: string; bookingNumber: string; jobName: string } | null;
  _count: { lineItems: number; invoices: number };
};

// Mirrors the cadence palette used on the Jobs list, the Dispatch
// board, and the Order detail page so the pill reads the same here.
// Keys preserved as-is — this file uses legacy CONFIRMED/ACTIVE
// instead of the canonical BOOKED/ON_JOB, but that's a data concern
// (the /api/orders response shape) and out of scope for a styling
// commit.
const STATUS_COLORS: Record<string, string> = {
  DRAFT:      "bg-chip-neutral-bg text-chip-neutral-fg",
  QUOTE_SENT: "bg-chip-warn-bg text-chip-warn-fg",
  CONFIRMED:  "bg-cadence-booked-bg text-cadence-booked-fg",
  ACTIVE:     "bg-cadence-on-rental-bg text-cadence-on-rental-fg",
  RETURNED:   "bg-cadence-returned-bg text-cadence-returned-fg",
  CLOSED:     "bg-cadence-wrapped-bg text-cadence-wrapped-fg",
  CANCELLED:  "bg-chip-bad-bg text-chip-bad-fg",
};

const ALL_STATUSES = ["DRAFT", "QUOTE_SENT", "CONFIRMED", "ACTIVE", "RETURNED", "CLOSED", "CANCELLED"];

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  // Draft hygiene (order consolidation Phase A): hide DRAFT rows by
  // default so abandoned parses don't clutter the operational list.
  // Toggle reveals them; an explicit status=DRAFT filter overrides
  // either way (the API gives the rep what they asked for).
  const [showDrafts, setShowDrafts] = useState(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (showDrafts) params.set("includeDrafts", "1");
    params.set("page", String(page));
    params.set("limit", "25");

    const res = await fetch(`/api/orders?${params}`);
    const data = await res.json();
    setOrders(data.orders || []);
    setTotal(data.total || 0);
    setLoading(false);
  }, [search, statusFilter, page, showDrafts]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "--";

  return (
    // Light-motif page bg — overrides the shell's default so this
    // page reads as the same surface as Jobs and Order detail.
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1400px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-lt-fg">Orders</h1>
            <p className="text-sm text-lt-fg2 mt-1">
              {total} order{total !== 1 ? "s" : ""}
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

        <div className="flex gap-3 mb-4">
          <input
            type="text"
            placeholder="Search orders, companies..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="flex-1 max-w-sm px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg focus:outline-none focus:border-lt-fg2"
          >
            <option value="">All Statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
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

        <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lt-hairline text-lt-fg3 text-left text-[10px] font-semibold uppercase tracking-wider bg-lt-inner">
                <th className="px-4 py-3">Order #</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-center">Items</th>
                <th className="px-4 py-3">Agent</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-lt-fg3">
                    Loading...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-lt-fg3">
                    No orders found
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => router.push(`/orders/${order.id}`)}
                    className="border-b border-lt-hairline last:border-b-0 hover:bg-lt-inner cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-lt-fg3">{order.orderNumber}</span>
                    </td>
                    <td className="px-4 py-3 text-lt-fg font-medium">{order.company.name}</td>
                    <td className="px-4 py-3 text-lt-fg2 max-w-[200px] truncate">
                      {order.description || (order.booking ? order.booking.jobName : "--")}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${STATUS_COLORS[order.status] || "bg-chip-neutral-bg text-chip-neutral-fg"}`}>
                        {order.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-lt-fg2 whitespace-nowrap">
                      {fmtDate(order.startDate)} - {fmtDate(order.endDate)}
                    </td>
                    <td className="px-4 py-3 text-right text-lt-fg font-mono">
                      {fmt(order.total)}
                    </td>
                    <td className="px-4 py-3 text-center text-lt-fg2">
                      {order._count.lineItems}
                    </td>
                    <td className="px-4 py-3 text-lt-fg2">{order.agent.name}</td>
                  </tr>
                ))
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
    </div>
  );
}
