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
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ThreadDrawer } from '@/components/sales/ThreadDrawer';

type Scope = 'my' | 'team';

interface OpenQuote {
  id: string;
  orderNumber: string;
  total: number;
  sentAt: string | null;
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

  const total = (quotes ?? []).reduce((s, q) => s + q.total, 0);

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Quotes out</span>
        {quotes && quotes.length > 0 && (
          <span className="text-[11px] text-gray-400">
            {quotes.length} out · {fmtMoney(total)} in play
          </span>
        )}
      </div>

      {quotes === null && <div className="text-[12px] text-gray-400 py-4">Loading…</div>}
      {quotes !== null && quotes.length === 0 && (
        <div className="text-[12px] text-gray-400 py-4">Nothing waiting on a client. Send a quote and it lands here.</div>
      )}

      <div className="divide-y divide-gray-100">
        {(quotes ?? []).map((q) => {
          const nudge = nudges.get(q.id);
          return (
            <div key={q.id} className="py-2.5 flex items-center gap-3">
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
              </div>
              <div className="text-[13px] font-bold text-gray-900 tabular-nums">{fmtMoney(q.total)}</div>
              {nudge && (
                <button
                  onClick={() => setDrawerOrderId(q.id)}
                  className="flex-none text-[11px] font-bold px-2 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100"
                  title={`A ${STAGE_SHORT[nudge.stage]} follow-up is drafted and ready to review`}
                >
                  Nudge
                </button>
              )}
            </div>
          );
        })}
      </div>

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
