'use client';

/**
 * Quotes out — THE one "sent, waiting on the client" list.
 *
 * Consolidation (2026-08-21 sales-workspace redesign): before this,
 * a single SENT quote rendered in four places on the pipeline page
 * (OpenQuotesPanel, the kanban SENT column, the Stale Quotes signal,
 * and FollowUpsDuePanel). This panel replaces all four with one row
 * per quote: the money, how long it's been quiet, and — when the
 * follow-up cron has a nag drafted — a Nudge button that opens the
 * same ThreadDrawer the old panel used. Rows link to the order.
 *
 * Colored by PICKUP date, not by age (Wes 2026-08-31: "I want to see
 * when the Pickup Date was … color code this list so that it's obvious
 * when we are likely to miss a job because of when the job starts").
 * Age was the only clock here before, and it is the wrong one — a quote
 * sent eight days ago for an October job is fine; one sent this morning
 * for a pickup tomorrow is the emergency. On the day this shipped, four
 * of the nine open quotes were already PAST their pickup and the list
 * gave no sign of it. Bands live in src/lib/sales/quoteUrgency.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ThreadDrawer } from '@/components/sales/ThreadDrawer';
import {
  URGENCY_STYLE, fmtPickup, pickupLabel, quoteUrgency,
} from '@/lib/sales/quoteUrgency';

type Scope = 'my' | 'team';

interface OpenQuote {
  id: string;
  orderNumber: string;
  total: number;
  sentAt: string | null;
  /** Order's own start, else the first line scheduled to leave. */
  pickupDate: string | null;
  company: { id: string; name: string } | null;
  job: { id: string; name: string; jobCode: string } | null;
  agent: { id: string; name: string } | null;
}

interface FollowUpRow {
  id: string;
  stage: 'DAY_0' | 'DAY_1' | 'DAY_3';
  order: { id: string };
}

const STAGE_SHORT: Record<FollowUpRow['stage'], string> = {
  DAY_0: 'same-day',
  DAY_1: 'day 1',
  DAY_3: 'day 3',
};

function fmtMoney(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function sentAge(iso: string | null): string {
  if (!iso) return 'awaiting send';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return '';
  if (days <= 0) return 'sent today';
  if (days === 1) return 'sent 1d ago';
  return `sent ${days}d ago`;
}

function ageTone(iso: string | null): string {
  if (!iso) return 'text-gray-400';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days >= 7) return 'text-amber-700 font-semibold';
  return 'text-gray-500';
}

export function QuotesOutPanel({ scope, refreshKey = 0 }: { scope: Scope; refreshKey?: number }) {
  const [quotes, setQuotes] = useState<OpenQuote[] | null>(null);
  const [nudges, setNudges] = useState<Map<string, FollowUpRow>>(new Map());
  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null);
  // Shut by default, and re-shut on every visit. These are a cleanup
  // queue, not the day's work.
  const [lostOpen, setLostOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/sales/open-quotes?scope=${scope}`)
      .then((r) => r.json())
      .then((d) => { if (active) setQuotes(d.quotes || []); })
      .catch(() => { if (active) setQuotes([]); });
    fetch(`/api/sales/follow-ups?scope=${scope}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        // Earliest pending nag per order — API returns dueAt ascending.
        const m = new Map<string, FollowUpRow>();
        for (const f of (d.followUps || []) as FollowUpRow[]) {
          if (!m.has(f.order.id)) m.set(f.order.id, f);
        }
        setNudges(m);
      })
      .catch(() => { if (active) setNudges(new Map()); });
    return () => { active = false; };
  }, [scope, refreshKey]);

  // Past-pickup quotes are separated, not just tinted. "In play" then
  // means what it says: on the live book the day this shipped, four of
  // the nine open quotes were already past pickup and their $2,971 was
  // being counted as money still winnable.
  const all = quotes ?? [];
  const lost = all.filter((q) => quoteUrgency(q.pickupDate) === 'past');
  const live = all.filter((q) => quoteUrgency(q.pickupDate) !== 'past');
  const total = live.reduce((s, q) => s + q.total, 0);
  const lostTotal = lost.reduce((s, q) => s + q.total, 0);

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Quotes out</span>
        {live.length > 0 && (
          <span className="text-[11px] text-gray-400">
            {live.length} out · {fmtMoney(total)} in play
          </span>
        )}
      </div>

      {quotes === null && <div className="text-[12px] text-gray-400 py-4">Loading…</div>}
      {quotes !== null && live.length === 0 && lost.length === 0 && (
        <div className="text-[12px] text-gray-400 py-4">Nothing waiting on a client. Send a quote and it lands here.</div>
      )}
      {quotes !== null && live.length === 0 && lost.length > 0 && (
        <div className="text-[12px] text-gray-400 py-3">Nothing still winnable. The ones below need closing out.</div>
      )}

      {live.length > 0 && (
        <div className="divide-y divide-gray-100">
          {live.map((q) => (
            <QuoteRow key={q.id} q={q} nudge={nudges.get(q.id)} onNudge={setDrawerOrderId} />
          ))}
        </div>
      )}

      {/* Lost Quotes — Wes 2026-08-31: "let's put them in their own
          spot." Quotes whose pickup date has passed while they were
          still out. They cannot be won any more, and mixed into the
          live list they were four of nine rows competing with the job
          picking up today.

          NOT the same as quoteStatus = LOST. These are still SENT; the
          system has not written anything off. That is precisely why they
          need a spot — somebody has to open each one and either chase it
          or mark it lost with a reason, and until then it sits here
          rather than inflating "in play".

          Collapsed behind its count, the way the Responded block is
          (Wes 2026-08-29) — visible enough to act on, quiet enough not
          to be the first thing you read. */}
      {lost.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setLostOpen((v) => !v)}
            aria-expanded={lostOpen}
            className="w-full pt-3 pb-1 flex items-center gap-2 text-left group"
          >
            <span className="text-[10px] text-gray-400 group-hover:text-gray-600 transition-transform">
              {lostOpen ? '▾' : '▸'}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-700">
              Lost quotes · {lost.length}
            </span>
            <span className="text-[10px] text-gray-400">
              {fmtMoney(lostTotal)} · pickup passed
            </span>
            {!lostOpen && (
              <span className="text-[10px] text-gray-400 group-hover:text-gray-600">show</span>
            )}
            <div className="flex-1 border-t border-gray-100" />
          </button>
          {lostOpen && (
            <>
              <p className="text-[10px] text-gray-400 pb-1">
                Still open in the system. Open one to chase it, or mark it lost with a reason.
              </p>
              <div className="divide-y divide-gray-100">
                {lost.map((q) => (
                  <QuoteRow key={q.id} q={q} nudge={nudges.get(q.id)} onNudge={setDrawerOrderId} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {drawerOrderId && (
        <ThreadDrawer
          orderId={drawerOrderId}
          mode="followup"
          onClose={() => setDrawerOrderId(null)}
        />
      )}
    </section>
  );
}

/**
 * One quote row — shared by the live list and Lost quotes.
 *
 * Extracted when the two lists split: rendering the same row twice would
 * have let the money, the pickup line and the Nudge button drift apart
 * between the section you read every day and the one you read rarely,
 * and the rarely-read one is where a drift would survive longest.
 */
function QuoteRow({
  q,
  nudge,
  onNudge,
}: {
  q: OpenQuote;
  nudge?: FollowUpRow;
  onNudge: (orderId: string) => void;
}) {
  const style = URGENCY_STYLE[quoteUrgency(q.pickupDate)];
  const pickupOn = fmtPickup(q.pickupDate);
  return (
    <div className={`py-2.5 pr-1 flex items-center gap-3 ${style.row}`}>
      {/* Left edge marker — same vocabulary as the jobs rail, so the
          color means the same thing on both surfaces. */}
      <span className={`w-1 self-stretch rounded-sm flex-none ${style.rail}`} />
      <div className="min-w-0 flex-1">
        <Link href={`/orders/${q.id}`} className="text-[13px] font-semibold text-gray-900 hover:text-amber-700 truncate block">
          {q.job?.name || q.orderNumber}
          <span className="text-gray-400 font-normal"> · {q.company?.name || '—'}</span>
        </Link>
        <div className="text-[11px] text-gray-400 truncate">
          {q.orderNumber}
          {q.agent?.name ? ` · ${q.agent.name}` : ''}
          {' · '}
          <span className={ageTone(q.sentAt)}>{sentAge(q.sentAt)}</span>
        </div>
        {/* The pickup date AND the countdown. The date alone makes you do
            the arithmetic; the countdown alone asks you to trust it.
            Both, and neither has to be taken on faith. */}
        <div className={`text-[11px] truncate ${style.text}`}>
          {pickupOn ? `Pickup ${pickupOn} · ` : ''}
          {pickupLabel(q.pickupDate)}
        </div>
      </div>
      <div className="text-[13px] font-bold text-gray-900 tabular-nums">{fmtMoney(q.total)}</div>
      {nudge && (
        <button
          onClick={() => onNudge(q.id)}
          className="flex-none text-[11px] font-bold px-2 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100"
          title={`A ${STAGE_SHORT[nudge.stage]} follow-up is drafted and ready to review`}
        >
          Nudge
        </button>
      )}
    </div>
  );
}
