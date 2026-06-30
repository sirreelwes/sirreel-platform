'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Scope = 'my' | 'team';

interface OpenQuote {
  id: string;
  orderNumber: string;
  total: number;
  sentAt: string | null;
  company: { id: string; name: string } | null;
  job: { id: string; jobCode: string; name: string } | null;
  agent: { id: string; name: string } | null;
}

function fmtMoney(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// "sent today" / "sent 12d ago" — the age that puts the stalest money on top.
function sentAge(iso: string | null): string {
  if (!iso) return 'awaiting send';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'sent today';
  if (days === 1) return 'sent 1d ago';
  return `sent ${days}d ago`;
}

// Amber the rows that have gone quiet for a while — visual triage cue.
function ageTone(iso: string | null): string {
  if (!iso) return 'text-gray-400';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days >= 7) return 'text-amber-700 font-semibold';
  return 'text-gray-500';
}

export function OpenQuotesPanel({ scope }: { scope: Scope }) {
  const [quotes, setQuotes] = useState<OpenQuote[] | null>(null);

  useEffect(() => {
    let active = true;
    setQuotes(null);
    fetch(`/api/sales/open-quotes?scope=${scope}`)
      .then((r) => r.json())
      .then((d) => { if (active) setQuotes(d.quotes || []); })
      .catch(() => { if (active) setQuotes([]); });
    return () => { active = false; };
  }, [scope]);

  const total = (quotes ?? []).reduce((s, q) => s + q.total, 0);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Open Quotes</span>
        {quotes && quotes.length > 0 && (
          <span className="text-[11px] text-gray-500">
            {quotes.length} out · <span className="font-semibold text-gray-700">{fmtMoney(total)}</span> in play
          </span>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {quotes === null ? (
          <div className="px-4 py-6 text-center text-[12px] text-gray-400">Loading open quotes…</div>
        ) : quotes.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-gray-400">No quotes are out waiting on a client right now.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {quotes.map((q) => (
              <li key={q.id} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors">
                <div className="min-w-0 flex-1">
                  {q.job ? (
                    <Link href={`/jobs/${q.job.id}`} className="text-sm font-semibold text-gray-900 hover:underline truncate block">
                      {q.job.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-gray-900 truncate block">{q.orderNumber}</span>
                  )}
                  <div className="text-[11px] text-gray-500 truncate">
                    {q.company?.name || '—'}{q.agent ? ` · ${q.agent.name}` : ''}
                  </div>
                </div>
                <div className="flex-none text-right">
                  <div className="text-sm font-mono font-semibold text-gray-900">{fmtMoney(q.total)}</div>
                  <div className={`text-[11px] ${ageTone(q.sentAt)}`}>{sentAge(q.sentAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
