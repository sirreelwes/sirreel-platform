'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Scope = 'my' | 'team';

interface TopDeal {
  id: string;
  orderNumber: string;
  total: number;
  sentAt: string | null;
  company: { id: string; name: string } | null;
  job: { id: string; jobCode: string; name: string } | null;
  agent: { id: string; name: string } | null;
}

interface MetricsResponse {
  scope: Scope;
  period: { start: string; label: string };
  inquiriesNew: number;
  inquiriesNewLastMonth: number;
  inquiriesConvertedThisMonth: number;
  quotesSentThisMonth: number;
  conversionRate: number | null;
  conversionRatePrev: number | null;
  wonCount: number;
  wonTotal: number;
  wonTotalPrev: number;
  wonDelta: number | null;
  topOpenDeals: TopDeal[];
}

function fmtMoney(n: number, compact = false) {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    notation: compact ? 'compact' : 'standard',
  });
}

function fmtPct(n: number | null) {
  if (n == null) return '—';
  return `${Math.round(n * 100)}%`;
}

function deltaLine(current: number, prev: number, ratio: number | null) {
  if (ratio == null) return null;
  const pct = Math.round(ratio * 100);
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '–';
  const tone = pct > 0 ? 'text-emerald-600' : pct < 0 ? 'text-red-600' : 'text-gray-400';
  return <span className={`text-[10px] font-semibold ${tone}`}>{arrow} {Math.abs(pct)}% MoM</span>;
}

export function FunnelMetricsStrip({ scope }: { scope: Scope }) {
  const [data, setData] = useState<MetricsResponse | null>(null);

  useEffect(() => {
    fetch(`/api/sales/metrics?scope=${scope}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null));
  }, [scope]);

  if (!data) {
    return <div className="text-[11px] text-gray-400">Loading metrics…</div>;
  }

  const convDelta =
    data.conversionRate != null && data.conversionRatePrev != null
      ? data.conversionRate - data.conversionRatePrev
      : null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
          {data.period.label} · {scope === 'my' ? 'My Deals' : 'Team'}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="New Leads"
          value={String(data.inquiriesNew)}
          subline={
            <span className="text-[10px] text-gray-500">
              vs {data.inquiriesNewLastMonth} last month
            </span>
          }
        />
        <Kpi
          label="Conversion Rate"
          value={fmtPct(data.conversionRate)}
          subline={
            convDelta != null ? (
              <span className={`text-[10px] font-semibold ${convDelta > 0 ? 'text-emerald-600' : convDelta < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {convDelta > 0 ? '▲' : convDelta < 0 ? '▼' : '–'} {Math.abs(Math.round(convDelta * 100))}pp vs last month
              </span>
            ) : (
              <span className="text-[10px] text-gray-500">no data last month</span>
            )
          }
        />
        <Kpi
          label="Quotes Sent"
          value={String(data.quotesSentThisMonth)}
          subline={
            <span className="text-[10px] text-gray-500">
              {data.inquiriesConvertedThisMonth} from inquiries
            </span>
          }
        />
        <Kpi
          label="$ Won"
          value={fmtMoney(data.wonTotal, true)}
          subline={
            <span className="space-x-1.5">
              <span className="text-[10px] text-gray-500">{data.wonCount} deal{data.wonCount === 1 ? '' : 's'}</span>
              {deltaLine(data.wonTotal, data.wonTotalPrev, data.wonDelta)}
            </span>
          }
        />
      </div>

      {data.topOpenDeals.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            Top Open Deals
          </div>
          <ul className="divide-y divide-gray-100">
            {data.topOpenDeals.map((d) => (
              <li key={d.id} className="py-1.5 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 text-sm">
                  {d.job ? (
                    <Link href={`/jobs/${d.job.id}`} className="text-gray-900 hover:underline truncate block">
                      {d.job.name}
                    </Link>
                  ) : (
                    <span className="text-gray-900 truncate block">{d.orderNumber}</span>
                  )}
                  <div className="text-[11px] text-gray-500 truncate">
                    {d.company?.name || '—'}{d.agent ? ` · ${d.agent.name}` : ''}
                  </div>
                </div>
                <span className="text-sm font-mono font-semibold text-gray-900">{fmtMoney(d.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value, subline }: { label: string; value: string; subline?: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1 leading-none">{value}</div>
      {subline && <div className="mt-1.5">{subline}</div>}
    </div>
  );
}
