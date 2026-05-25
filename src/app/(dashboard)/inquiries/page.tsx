'use client'

/**
 * /inquiries — operator triage queue.
 *
 * Phase 4 of the supply-ordering brief. Surfaces DB Inquiry rows
 * (the InquiriesSection in CRM only shows Gmail suggestions, which
 * is a different stream — see InquiriesSection.tsx header comment).
 *
 * Default view: status=NEW, all sources. Source chips filter the
 * client-side list; status chips swap the API filter.
 * Click a row → /inquiries/[id] for structured rendering + actions.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type InquiryStatus = 'NEW' | 'CONVERTED' | 'DISMISSED'
type InquirySource = 'MANUAL' | 'GMAIL' | 'WEB_FORM'

interface InquiryRow {
  id: string
  title: string
  description: string
  source: InquirySource
  status: InquiryStatus
  estimatedValue: number | null
  preferredStartDate: string | null
  preferredEndDate: string | null
  createdAt: string
  company: { id: string; name: string } | null
  person: { id: string; firstName: string; lastName: string; email: string } | null
  assignedTo: { id: string; name: string } | null
  convertedJob: { id: string; jobCode: string; name: string } | null
  sourceMetadata: Record<string, unknown> | null
}

const SOURCE_LABEL: Record<InquirySource, string> = {
  MANUAL: 'Manual',
  GMAIL: 'Gmail',
  WEB_FORM: 'Web form',
}
const SOURCE_BADGE: Record<InquirySource, string> = {
  MANUAL: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  GMAIL: 'bg-blue-50 text-blue-700 border-blue-200',
  WEB_FORM: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}
const STATUS_BADGE: Record<InquiryStatus, string> = {
  NEW: 'bg-amber-50 text-amber-800 border-amber-200',
  CONVERTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DISMISSED: 'bg-zinc-50 text-zinc-500 border-zinc-200',
}

const STATUS_FILTERS: { id: 'NEW' | 'ALL'; label: string }[] = [
  { id: 'NEW', label: 'New' },
  { id: 'ALL', label: 'All' },
]
const SOURCE_FILTERS: { id: 'all' | InquirySource; label: string }[] = [
  { id: 'all', label: 'All sources' },
  { id: 'WEB_FORM', label: 'Web form' },
  { id: 'MANUAL', label: 'Manual' },
  { id: 'GMAIL', label: 'Gmail' },
]

function ageString(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return m <= 1 ? 'just now' : `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}
function fmtMoney(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return '—'
  const fmt = (s: string | null) =>
    s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?'
  return `${fmt(start)} → ${fmt(end)}`
}

export default function InquiriesQueuePage() {
  const [statusFilter, setStatusFilter] = useState<'NEW' | 'ALL'>('NEW')
  const [sourceFilter, setSourceFilter] = useState<'all' | InquirySource>('all')
  const [data, setData] = useState<InquiryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ status: statusFilter })
    fetch(`/api/inquiries?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setData(d.inquiries || [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [statusFilter])

  const visible = useMemo(() => {
    if (sourceFilter === 'all') return data
    return data.filter((r) => r.source === sourceFilter)
  }, [data, sourceFilter])

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-white">Inquiries</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Triage queue for inbound requests — web-form supply orders, manual entries, and Gmail
          conversions. Click a row to open the full detail + actions.
        </p>
      </header>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                statusFilter === f.id
                  ? 'bg-white text-zinc-900 border-white'
                  : 'bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500 hover:text-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="h-5 w-px bg-zinc-700" />
        <div className="flex items-center gap-1.5">
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setSourceFilter(f.id)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                sourceFilter === f.id
                  ? 'bg-white text-zinc-900 border-white'
                  : 'bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500 hover:text-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-zinc-500">
          {loading ? 'Loading…' : error ? error : `${visible.length} inquiry${visible.length === 1 ? 'y' : 'ies'}`}
        </span>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-950/40">
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2.5">Source</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Title</th>
              <th className="px-3 py-2.5">Contact / Company</th>
              <th className="px-3 py-2.5">Dates</th>
              <th className="px-3 py-2.5 text-right">Est. value</th>
              <th className="px-3 py-2.5">Assigned</th>
              <th className="px-3 py-2.5 text-right">Age</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-zinc-500 text-sm">
                  No inquiries match.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const meta = (r.sourceMetadata as { contact?: { name?: string; email?: string } } | null) ?? null
              const webFormContactName = meta?.contact?.name
              const contactDisplay =
                webFormContactName ||
                (r.person ? `${r.person.firstName} ${r.person.lastName}`.trim() : null) ||
                meta?.contact?.email ||
                '—'
              const companyDisplay = r.company?.name || null
              return (
                <tr key={r.id} className="hover:bg-zinc-800/40 transition-colors">
                  <td className="px-3 py-2.5">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${SOURCE_BADGE[r.source]}`}
                    >
                      {SOURCE_LABEL[r.source]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${STATUS_BADGE[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/inquiries/${r.id}`} className="text-zinc-100 hover:text-amber-400 font-medium">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-300">
                    <div className="truncate max-w-[220px]">{contactDisplay}</div>
                    {companyDisplay && <div className="text-zinc-500 truncate max-w-[220px]">{companyDisplay}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                    {fmtDateRange(r.preferredStartDate, r.preferredEndDate)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono text-zinc-100 whitespace-nowrap">
                    {fmtMoney(r.estimatedValue)}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 truncate max-w-[140px]">
                    {r.assignedTo?.name || <span className="text-zinc-600">unassigned</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-zinc-500 whitespace-nowrap">
                    {ageString(r.createdAt)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
