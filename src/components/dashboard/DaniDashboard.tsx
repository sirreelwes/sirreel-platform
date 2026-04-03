'use client'

import { useState, useEffect } from 'react'

const nowHour = new Date().getHours()
const greeting = nowHour < 12 ? 'Good morning' : nowHour < 17 ? 'Good afternoon' : 'Good evening'

function fmtMoney(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function timeAgo(iso: string) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

interface StatCardProps { label: string; value: string | number; sub: string; color: 'amber' | 'red' | 'purple' | 'emerald' | 'blue' }
function StatCard({ label, value, sub, color }: StatCardProps) {
  const colors = { amber: 'text-amber-600', red: 'text-red-600', purple: 'text-purple-600', emerald: 'text-emerald-600', blue: 'text-blue-600' }
  return (
    <div className="p-3 bg-white rounded-xl border border-gray-200">
      <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">{label}</div>
      <div className={`text-2xl font-extrabold ${colors[color]}`}>{value}</div>
      <div className="text-[10px] text-gray-500">{sub}</div>
    </div>
  )
}

function IncompleteJobsWidget({ jobs, loading }: { jobs: any[]; loading: boolean }) {
  return (
    <div className="p-4 bg-white rounded-xl border border-gray-200">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">⚠️ Paperwork Incomplete</div>
      {loading ? (
        <div className="text-[11px] text-gray-400 py-8 text-center">Loading...</div>
      ) : jobs.length === 0 ? (
        <div className="text-[11px] text-gray-400 py-8 text-center">✅ All paperwork up to date</div>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {jobs.map((j: any, i: number) => (
            <a key={i} href={`/jobs/${j.id}?tab=paperwork`}
              className="flex items-center justify-between p-2.5 rounded-lg border border-amber-100 bg-amber-50/40 hover:bg-amber-50 transition-colors">
              <div className="min-w-0 mr-2">
                <div className="text-[12px] font-bold text-gray-900 truncate">{j.companyName || '—'}</div>
                <div className="text-[10px] text-gray-500 truncate">{j.jobName || 'Unnamed job'}</div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {!j.coiReceived && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-700">COI</span>}
                {!j.wcReceived  && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-100 text-orange-700">WC</span>}
                <span className="text-[10px] text-gray-400 ml-1">→</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function CoiQueueWidget({ items, loading }: { items: any[]; loading: boolean }) {
  return (
    <div className="p-4 bg-white rounded-xl border border-gray-200">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">📄 COI Review Queue</div>
      {loading ? (
        <div className="text-[11px] text-gray-400 py-8 text-center">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-gray-400 py-8 text-center">✅ No COIs pending review</div>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {items.map((item: any, i: number) => {
            const review = item.coiAiReview
              ? (typeof item.coiAiReview === 'string' ? JSON.parse(item.coiAiReview) : item.coiAiReview)
              : null
            const critFails = !review?.criticalPass
            const alertFails = !review?.alertPass
            return (
              <a key={i} href={`/jobs/${item.bookingId}?tab=paperwork`}
                className="flex items-center justify-between p-2.5 rounded-lg border border-red-100 bg-red-50/40 hover:bg-red-50 transition-colors">
                <div className="min-w-0 mr-2">
                  <div className="text-[12px] font-bold text-gray-900 truncate">{item.companyName || '—'}</div>
                  <div className="text-[10px] text-gray-500 truncate">{item.jobName || 'Unnamed job'}</div>
                </div>
                <div className="flex gap-1 flex-shrink-0 items-center">
                  {critFails && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-700">🔴 Critical</span>}
                  {!critFails && alertFails && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">🟡 Alert</span>}
                  <span className="text-[10px] text-gray-400 ml-1">Review →</span>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RedlineWidget({ items, loading }: { items: any[]; loading: boolean }) {
  return (
    <div className="p-4 bg-white rounded-xl border border-gray-200">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">📝 Agreement Redlines</div>
      {loading ? (
        <div className="text-[11px] text-gray-400 py-8 text-center">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-gray-400 py-8 text-center">✅ No redlines pending</div>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {items.map((item: any, i: number) => {
            const review = item.redlineReview
              ? (typeof item.redlineReview === 'string' ? JSON.parse(item.redlineReview) : item.redlineReview)
              : null
            const riskBg = review?.riskLevel === 'high'
              ? 'border-red-100 bg-red-50/40 hover:bg-red-50'
              : review?.riskLevel === 'medium'
              ? 'border-amber-100 bg-amber-50/40 hover:bg-amber-50'
              : 'border-gray-100 bg-gray-50 hover:bg-gray-100'
            const riskBadge = review?.riskLevel === 'high'
              ? 'bg-red-100 text-red-700'
              : review?.riskLevel === 'medium'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-gray-100 text-gray-600'
            return (
              <a key={i} href={`/jobs/${item.bookingId}?tab=paperwork`}
                className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors ${riskBg}`}>
                <div className="min-w-0 mr-2">
                  <div className="text-[12px] font-bold text-gray-900 truncate">{item.companyName || '—'}</div>
                  <div className="text-[10px] text-gray-500 truncate">{review?.summary || item.jobName || 'Agreement redline'}</div>
                  {item.redlineUploadedAt && <div className="text-[9px] text-gray-400">{timeAgo(item.redlineUploadedAt)}</div>}
                </div>
                <div className="flex gap-1 flex-shrink-0 items-center">
                  {review?.riskLevel && (
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${riskBadge}`}>{review.riskLevel.toUpperCase()}</span>
                  )}
                  {(review?.notAcceptableCount ?? 0) > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-700">{review.notAcceptableCount} ✗</span>
                  )}
                  <span className="text-[10px] text-gray-400 ml-1">Review →</span>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RecentActivityWidget({ items, loading }: { items: any[]; loading: boolean }) {
  return (
    <div className="p-4 bg-white rounded-xl border border-gray-200">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">🕐 Recent Portal Activity</div>
      {loading ? (
        <div className="text-[11px] text-gray-400 py-8 text-center">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-gray-400 py-8 text-center">No recent activity</div>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {items.map((item: any, i: number) => {
            const done = [item.coiReceived, item.wcReceived].filter(Boolean).length
            return (
              <a key={i} href={`/jobs/${item.bookingId}?tab=paperwork`}
                className="flex items-center justify-between p-2.5 rounded-lg border border-gray-100 bg-white hover:bg-gray-50 transition-colors">
                <div className="min-w-0 mr-2">
                  <div className="text-[12px] font-bold text-gray-900 truncate">{item.companyName || '—'}</div>
                  <div className="text-[10px] text-gray-500 truncate">{item.jobName || 'Unnamed job'}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="text-right">
                    <div className="text-[10px] text-gray-400">{timeAgo(item.updatedAt)}</div>
                    <div className="text-[9px] text-gray-400">{done}/2 docs</div>
                  </div>
                  <div className={`w-2 h-2 rounded-full ${done === 2 ? 'bg-emerald-400' : done > 0 ? 'bg-amber-400' : 'bg-gray-200'}`} />
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CollectionsWidget({ rwOrders, loading }: { rwOrders: any[]; loading: boolean }) {
  const today = new Date().toISOString().slice(0, 10)
  const thisMonth = new Date().toISOString().slice(0, 7)

  const collectedToday = rwOrders
    .filter(o => ['ACTIVE', 'COMPLETE', 'CLOSED'].includes(o.status) && (o.startDate || '').startsWith(today))
    .reduce((s: number, o: any) => s + (o.invoiced || 0), 0)

  const outstanding = rwOrders
    .filter(o => ['CONFIRMED', 'ACTIVE'].includes(o.status))
    .reduce((s: number, o: any) => s + Math.max(0, (o.total || 0) - (o.invoiced || 0)), 0)

  const mtd = rwOrders
    .filter(o => ['ACTIVE', 'COMPLETE', 'CLOSED'].includes(o.status) && (o.startDate || '').startsWith(thisMonth))
    .reduce((s: number, o: any) => s + (o.invoiced || 0), 0)

  return (
    <div className="p-4 bg-white rounded-xl border border-gray-200">
      <div className="flex justify-between items-center mb-3">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">💵 Collections</div>
        <span className="text-[10px] text-gray-400">RentalWorks · Live</span>
      </div>
      {loading ? (
        <div className="text-[11px] text-gray-400 py-8 text-center">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="text-center p-3 rounded-lg bg-emerald-50 border border-emerald-100">
              <div className="text-[9px] font-bold text-emerald-600 uppercase mb-1">Today</div>
              <div className="text-lg font-extrabold text-emerald-700">{fmtMoney(collectedToday)}</div>
              <div className="text-[9px] text-emerald-500">invoiced</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-gray-50 border border-gray-100">
              <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">MTD</div>
              <div className="text-lg font-extrabold text-gray-900">{fmtMoney(mtd)}</div>
              <div className="text-[9px] text-gray-400">this month</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-amber-50 border border-amber-100">
              <div className="text-[9px] font-bold text-amber-600 uppercase mb-1">Outstanding</div>
              <div className="text-lg font-extrabold text-amber-700">{fmtMoney(outstanding)}</div>
              <div className="text-[9px] text-amber-500">not yet invoiced</div>
            </div>
          </div>
          <div className="p-2 rounded-lg bg-gray-50 border border-gray-100 text-[10px] text-gray-400 text-center">
            💳 CardPointe daily batch deposits — check terminal for same-day card payments
          </div>
        </>
      )}
    </div>
  )
}

export default function DaniDashboard({ userName }: { userName: string }) {
  const [summary, setSummary] = useState<any>(null)
  const [rwOrders, setRwOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/paperwork-summary').then(r => r.json()).catch(() => ({})),
      fetch('/api/rentalworks').then(r => r.json()).catch(() => ({})),
    ]).then(([sum, rw]) => {
      setSummary(sum)
      if (rw?.orders?.Rows) {
        const cols = rw.orders.ColumnIndex
        const rows = rw.orders.Rows.map((r: any[]) => ({
          orderId:   r[cols.OrderId],
          customer:  r[cols.Customer],
          total:     Number(r[cols.Total]) || 0,
          invoiced:  Number(r[cols.InvoicedAmount]) || 0,
          status:    r[cols.Status],
          startDate: r[cols.EstimatedStartDate] || '',
        }))
        setRwOrders(rows)
      }
    }).finally(() => setLoading(false))
  }, [])

  const incompleteJobs = summary?.incompleteJobs || []
  const coiQueue       = summary?.coiQueue       || []
  const redlines       = summary?.redlines       || []
  const recentActivity = summary?.recentActivity || []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{greeting}, {userName.split(' ')[0]} 👋</h1>
          <p className="text-[12px] text-gray-500">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · SirReel HQ
          </p>
        </div>
        <div className="flex gap-2">
          {coiQueue.length > 0 && (
            <div className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-700 font-bold">
              🔴 {coiQueue.length} COI{coiQueue.length !== 1 ? 's' : ''} need review
            </div>
          )}
          {redlines.length > 0 && (
            <div className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-700 font-bold">
              📝 {redlines.length} redline{redlines.length !== 1 ? 's' : ''} pending
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard label="Incomplete Paperwork" value={incompleteJobs.length} sub="jobs need action"     color="amber"   />
        <StatCard label="COI Review Queue"      value={coiQueue.length}       sub="waiting for approval" color="red"     />
        <StatCard label="Redlines Pending"      value={redlines.length}       sub="agreement disputes"   color="purple"  />
        <StatCard label="Active Jobs"
          value={rwOrders.filter((o: any) => o.status === 'ACTIVE').length || '—'}
          sub="from RentalWorks" color="blue" />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <IncompleteJobsWidget jobs={incompleteJobs} loading={loading} />
        <CoiQueueWidget       items={coiQueue}      loading={loading} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <RedlineWidget        items={redlines}       loading={loading} />
        <RecentActivityWidget items={recentActivity} loading={loading} />
      </div>

      <CollectionsWidget rwOrders={rwOrders} loading={loading} />
    </div>
  )
}
