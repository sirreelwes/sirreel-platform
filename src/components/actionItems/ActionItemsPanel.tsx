'use client';

/**
 * Action Items — one list fed by the provider registry
 * (/api/action-items). Defaults to "mine" (items matching the user's
 * role); admins get an "all" toggle. "Mark handled" dismisses via the
 * shared per-user dismiss pattern.
 *
 * Lives on the /jobs landing since 2026-08-27 (Wes: "fold Action Items
 * into the Jobs page — no need for a separate page"); /action-items
 * redirects there. Rendered as a section card, and OMITTED entirely
 * when the list is empty — an all-clear needs no card (the house
 * omit-don't-dim rule).
 *
 * GROUPED since 2026-09-06 (Wes: "action items has gotten so long it
 * isn't helpful"). The flat list was 26 rows, 8 of them the same
 * "Assign units — …" sentence, and the landing scrolled a full screen
 * before the inbound queue. Now each provider is one collapsed group
 * with a count and the newest item as a preview; opening a group
 * shows its rows (capped, with "show all"), and the repeated verb
 * moves into the group header so each row is just the WHO. The panel
 * itself collapses to a single summary line. Nothing about the items
 * changed — same ids, same dismissals, same hrefs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ActionItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  priority: 'high' | 'medium' | 'low';
  href: string | null;
  occurredAt: string;
  source: string;
  dismissal: { kind: 'alert'; alertId: string } | { kind: 'sideRow' };
}

const PRIORITY_RANK: Record<ActionItem['priority'], number> = { high: 0, medium: 1, low: 2 };

const PRIORITY_STYLE: Record<string, { dot: string; chip: string; label: string }> = {
  high: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 border-red-200', label: 'High' },
  medium: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Medium' },
  low: { dot: 'bg-gray-400', chip: 'bg-gray-50 text-gray-600 border-gray-200', label: 'Low' },
};

/** One group per provider. `label` is the header (the verb the rows
 *  used to repeat); `hint` is the one-line why. Unknown sources fall
 *  back to their id so a new provider is never invisible. */
const GROUP_META: Record<string, { label: string; hint: string }> = {
  'hold-unassigned': { label: 'Assign units', hint: 'Quotes went out with a category on hold and no truck picked yet' },
  'payment-info': { label: 'Payment info requests', hint: 'A client asked for billing details' },
  'coi-missing': { label: 'COI', hint: 'Certificates missing, rejected, or waiting on review' },
  'card-required': { label: 'Card not on file', hint: 'The card link went out and nothing came back — key in a signed authorization or the yard cannot release the vehicle' },
  'quote-aging': { label: 'Quotes gone quiet', hint: 'Sent, no reply — follow up' },
  'inquiry-untouched': { label: 'Inquiries waiting', hint: 'Past the first-response SLA' },
  'check-report-changes': { label: 'Order changed at the dock', hint: 'The yard changed a booked order and the agent has not acknowledged it' },
  'lcdw-unapplied': { label: 'Damage waiver mismatch', hint: 'The client’s waiver answer and the quote’s money disagree' },
  'partner-coi-missing': { label: 'Partner COI', hint: 'A vehicle partner signed and we hold no certificate' },
  'rw-token': { label: 'RentalWorks', hint: 'The RentalWorks credential needs renewing' },
};

/** Rows inside a group shouldn't repeat the group's verb. Provider
 *  titles are "Verb — Subject"; the subject becomes the row head and
 *  the verb survives only as a small tag when it differs from the
 *  group label (e.g. "COI rejected" inside the COI group). */
function splitTitle(title: string, groupLabel: string): { head: string; tag: string | null } {
  const i = title.indexOf(' — ');
  if (i < 0) return { head: title, tag: null };
  const verb = title.slice(0, i).trim();
  const subject = title.slice(i + 3).trim();
  if (!subject) return { head: title, tag: null };
  const tag = verb.toLowerCase() === groupLabel.toLowerCase() ? null : verb;
  return { head: subject, tag };
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  // Sub-day precision matters here: "today" hid how long an untouched
  // web inquiry had actually been waiting (12h read the same as 12min).
  if (days < 1) {
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
    return `${hours}h ago`;
  }
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Rows shown when a group is first opened; "Show all" lifts the cap. */
const GROUP_CAP = 5;

interface Group {
  source: string;
  label: string;
  hint: string;
  items: ActionItem[];
  /** Loudest priority inside the group — drives its dot and its order. */
  priority: ActionItem['priority'];
}

export function ActionItemsPanel() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [canSeeAll, setCanSeeAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which groups are open and which have lifted their cap. Nothing is
  // open on load: the header line per group IS the summary.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [uncapped, setUncapped] = useState<Set<string>>(() => new Set());
  const [panelOpen, setPanelOpen] = useState(true);

  const load = useCallback((v: 'mine' | 'all') => {
    setLoading(true);
    fetch(`/api/action-items?view=${v}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setItems(d.items || []);
          setCanSeeAll(!!d.canSeeAll);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(view);
  }, [view, load]);

  const dismiss = async (item: ActionItem) => {
    setBusyId(item.id);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await fetch('/api/action-items/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, dismissal: item.dismissal }),
      });
    } catch {
      /* optimistic — reappears on next load if the write failed */
    } finally {
      setBusyId(null);
    }
  };

  const groups = useMemo<Group[]>(() => {
    const by = new Map<string, ActionItem[]>();
    for (const it of items) {
      const arr = by.get(it.source) ?? [];
      arr.push(it);
      by.set(it.source, arr);
    }
    const out: Group[] = [];
    for (const [source, list] of by) {
      const meta = GROUP_META[source] ?? { label: source, hint: '' };
      // Items arrive priority-sorted then newest-first from the registry;
      // keep that order inside the group.
      const priority = list.reduce<ActionItem['priority']>(
        (p, it) => (PRIORITY_RANK[it.priority] < PRIORITY_RANK[p] ? it.priority : p),
        'low',
      );
      out.push({ source, label: meta.label, hint: meta.hint, items: list, priority });
    }
    // Loudest group first, then the bigger pile.
    out.sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.items.length - a.items.length,
    );
    return out;
  }, [items]);

  const toggle = (source: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });

  // All clear → no card at all. An empty "well done" box is noise on a
  // landing that already has three working surfaces. Admins keep the card
  // even when empty: hiding it would also hide the Mine/All toggle that is
  // their only route to the org-wide view.
  if (!loading && items.length === 0 && view === 'mine' && !canSeeAll) return null

  const highCount = items.filter((i) => i.priority === 'high').length;

  return (
    <section className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <header className="px-4 py-2.5 border-b border-zinc-100 flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="flex items-center gap-2 text-left min-h-[44px] md:min-h-0"
          title={panelOpen ? 'Collapse to one line' : 'Expand'}
        >
          {panelOpen ? (
            <ChevronDown size={14} aria-hidden className="text-zinc-400" />
          ) : (
            <ChevronRight size={14} aria-hidden className="text-zinc-400" />
          )}
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-zinc-800">Action Items</h2>
          <span className="text-[11px] text-zinc-400">
            {loading
              ? 'loading…'
              : `${items.length} ${view === 'mine' ? 'for your role' : 'across the org'}${
                  highCount > 0 ? ` · ${highCount} high` : ''
                }`}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {/* Collapsed: the summary IS the chips — one per group, so a
              glance still says what kind of work is waiting. */}
          {!panelOpen && !loading && (
            <span className="hidden md:flex items-center gap-1.5 flex-wrap">
              {groups.map((g) => (
                <button
                  key={g.source}
                  type="button"
                  onClick={() => {
                    setPanelOpen(true);
                    setOpen(new Set([g.source]));
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border border-zinc-200 text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_STYLE[g.priority].dot}`} />
                  {g.label}
                  <span className="tabular-nums text-zinc-400">{g.items.length}</span>
                </button>
              ))}
            </span>
          )}
          {canSeeAll && (
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setView('mine')}
                className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${view === 'mine' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                Mine
              </button>
              <button
                onClick={() => setView('all')}
                className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${view === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                All
              </button>
            </div>
          )}
        </div>
      </header>

      {!panelOpen ? null : loading ? (
        <div className="px-4 py-6 text-center text-zinc-400 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-4 py-4 text-center text-[12px] text-zinc-400">
          All caught up — nothing {view === 'mine' ? 'for your role' : 'across the org'} right now.
        </div>
      ) : (
        <div className="divide-y divide-zinc-100">
          {groups.map((g) => {
            const isOpen = open.has(g.source);
            const p = PRIORITY_STYLE[g.priority] ?? PRIORITY_STYLE.low;
            const newest = g.items[0];
            const preview = newest ? splitTitle(newest.title, g.label) : null;
            const visible = uncapped.has(g.source) ? g.items : g.items.slice(0, GROUP_CAP);
            const hidden = g.items.length - visible.length;
            return (
              <div key={g.source}>
                {/* Group header — a single line that reads as the summary:
                    the verb, how many, the loudest priority, and the newest
                    subject as a preview while closed. */}
                <button
                  type="button"
                  onClick={() => toggle(g.source)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 transition-colors min-h-[44px] md:min-h-0"
                  title={g.hint || undefined}
                >
                  {isOpen ? (
                    <ChevronDown size={14} aria-hidden className="text-zinc-400 flex-shrink-0" />
                  ) : (
                    <ChevronRight size={14} aria-hidden className="text-zinc-400 flex-shrink-0" />
                  )}
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.dot}`} />
                  <span className="text-[13px] font-semibold text-gray-900 whitespace-nowrap">{g.label}</span>
                  <span className="text-[12px] font-bold tabular-nums px-1.5 py-px rounded bg-zinc-100 text-zinc-600">
                    {g.items.length}
                  </span>
                  {!isOpen && preview && (
                    <span className="min-w-0 truncate text-[12px] text-gray-500">
                      {preview.head}
                      {g.items.length > 1 && (
                        <span className="text-gray-400"> and {g.items.length - 1} more</span>
                      )}
                    </span>
                  )}
                  {isOpen && g.hint && (
                    <span className="min-w-0 truncate text-[12px] text-gray-400">{g.hint}</span>
                  )}
                  <span className="ml-auto text-[10px] text-gray-400 whitespace-nowrap">
                    {newest ? `newest ${fmtWhen(newest.occurredAt)}` : ''}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-zinc-100 bg-zinc-50/40 divide-y divide-zinc-100">
                    {visible.map((item) => {
                      const ip = PRIORITY_STYLE[item.priority] ?? PRIORITY_STYLE.low;
                      const { head, tag } = splitTitle(item.title, g.label);
                      const Row = (
                        <div className="flex items-start gap-3 pl-10 pr-4 py-2 hover:bg-zinc-100/60 transition-colors">
                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${ip.dot}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13px] font-semibold text-gray-900">{head}</span>
                              {tag && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase tracking-wide">
                                  {tag}
                                </span>
                              )}
                              {/* Only say the priority when it differs from
                                  the group's own dot — a HIGH chip on every
                                  row of a HIGH group said nothing. */}
                              {item.priority !== g.priority && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${ip.chip}`}>
                                  {ip.label}
                                </span>
                              )}
                              <span className="text-[10px] text-gray-400">{fmtWhen(item.occurredAt)}</span>
                            </div>
                            <div className="text-[12px] text-gray-500 mt-0.5">{item.subtitle}</div>
                          </div>
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); void dismiss(item); }}
                            disabled={busyId === item.id}
                            className="flex-shrink-0 text-[11px] font-semibold text-gray-400 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-1.5 disabled:opacity-40"
                          >
                            Mark handled
                          </button>
                        </div>
                      );
                      return item.href ? (
                        <Link key={item.id} href={item.href} className="block">
                          {Row}
                        </Link>
                      ) : (
                        <div key={item.id}>{Row}</div>
                      );
                    })}
                    {hidden > 0 && (
                      <button
                        type="button"
                        onClick={() => setUncapped((prev) => new Set(prev).add(g.source))}
                        className="w-full text-left pl-10 pr-4 py-2 text-[12px] font-semibold text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100/60"
                      >
                        Show all {g.items.length}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
