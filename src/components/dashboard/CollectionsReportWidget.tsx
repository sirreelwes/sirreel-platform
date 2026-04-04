'use client'

import { useState, useEffect } from 'react'

type Period = 'day' | 'week' | 'month' | 'year'

function fmt(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function PctBadge({ pct }: { pct: number }) {
  if (pct === 0) return <span className="text-[9px] text-gray-400">—</span>
  const up = pct > 0
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${up ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
      {up ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  )
}

function MoneyRow({ label, curr, prev, pct }: { label: string; curr: number; prev: number; pct: number }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-[11px] text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-400">prev {fmt(prev)}</span>
        <PctBadge pct={pct} />
        <span className="text-[13px] font-bold text-gray-900 w-20 text-right">{fmt(curr)}</span>
      </div>
    </div>
  )
}

function Sparkline({ data }: { data: any[] }) {
  if (!data.length) return null
  const max = Math.max(...data.map(d => d.cardpointe + d.rentalworks), 1)
  return (
    <div className="flex items-end gap-0.5 h-8 mt-3">
      {data.map((d, i) => {
        const total = d.rentalworks // RW is total
        const h = Math.max(2, Math.round((total / max) * 32))
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div className="w-full rounded-sm bg-blue-200" style={{ height: h }} />
            <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-800 text-white text-[9px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
              {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: {fmt(total)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const PERIOD_LABELS: Record<Period, { label: string; vsLabel: string }> = {
  day:   { label: 'Today',      vsLabel: 'vs yesterday' },
  week:  { label: 'This Week',  vsLabel: 'vs last week' },
  month: { label: 'This Month', vsLabel: 'vs last month' },
  year:  { label: 'This Year',  vsLabel: 'vs last year' },
}

export default function CollectionsReportWidget() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('week')

  useEffect(() => {
    fetch('/api/admin/collections?t=' + Date.now())
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const p = data?.[period]
  const total = p ? p.curr.rentalworks : 0  // RW is total collected
  const prevTotal = p ? p.prev.rentalworks : 0
  const { label, vsLabel } = PERIOD_LABELS[period]

  return (
    <div className="p-4 bg-white rounded-xl border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">💳 CardPointe Collections</div>
        <div className="flex gap-1">
          {(['day','week','month','year'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${period === p ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-600'}`}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-[11px] text-gray-400 py-8 text-center">Loading...</div>
      ) : !data?.ok ? (
        <div className="text-[11px] text-gray-400 py-8 text-center">No collections data yet — populates automatically from Ana's EOD emails</div>
      ) : (
        <>
          {/* Total hero */}
          <div className="flex items-end justify-between mb-3">
            <div>
              <div className="text-[9px] text-gray-400 uppercase font-bold mb-0.5">{label} · Total</div>
              <div className="text-3xl font-extrabold text-gray-900">{fmt(total)}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-gray-400">{vsLabel} {fmt(prevTotal)}</span>
                <PctBadge pct={p.pctTotal} />
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">Orders Created</div>
              <div className="text-lg font-bold text-blue-600">{fmt(p.curr.ordersCreated)}</div>
              <div className="flex items-center gap-1 justify-end">
                <span className="text-[9px] text-gray-400">prev {fmt(p.prev.ordersCreated)}</span>
                <PctBadge pct={p.pctOrders} />
              </div>
            </div>
          </div>

          {/* Breakdown */}
          <div className="bg-gray-50 rounded-lg px-3 py-1 mb-3">
            <MoneyRow label="💳 CardPointe (CC)" curr={p.curr.cardpointe} prev={p.prev.cardpointe} pct={p.pctCardpointe} />
            <MoneyRow label="📋 Total Collected (RW)" curr={p.curr.rentalworks} prev={p.prev.rentalworks} pct={p.pctRentalworks} />
            <MoneyRow label="📝 Quotes Created" curr={p.curr.quotesCreated} prev={p.prev.quotesCreated} pct={0} />
          </div>

          {/* Sparkline — last 30 days */}
          {data.recent?.length > 0 && (
            <div>
              <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">Last {data.recent.length} days</div>
              <Sparkline data={data.recent} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
