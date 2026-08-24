'use client'

/**
 * Recent paperwork submissions — the cross-job index.
 *
 * Every submission already lives on its job's detail page. This list
 * exists for the other direction: a COI/WC/contract landed and nobody
 * remembers which job it was for. Rows link straight to the right
 * section of the job page, where the document can actually be opened.
 *
 * A credit-card authorization row names the document and the signer and
 * stops there — no card type, no last4. Charging a card on file is
 * collections' surface, not this one.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type SubmissionKind = 'COI' | 'WC' | 'CC_AUTH' | 'AGREEMENT' | 'REDLINE'

interface Submission {
  key: string
  kind: SubmissionKind
  label: string
  detail: string | null
  submittedAt: string
  submittedBy: string | null
  jobId: string | null
  jobCode: string | null
  jobName: string | null
  companyName: string | null
  href: string | null
}

const KIND_BADGE: Record<SubmissionKind, string> = {
  COI: 'bg-sky-100 text-sky-700',
  WC: 'bg-violet-100 text-violet-700',
  CC_AUTH: 'bg-emerald-100 text-emerald-700',
  AGREEMENT: 'bg-amber-100 text-amber-700',
  REDLINE: 'bg-red-100 text-red-700',
}

const KIND_SHORT: Record<SubmissionKind, string> = {
  COI: 'COI',
  WC: 'WC',
  CC_AUTH: 'Card auth',
  AGREEMENT: 'Agreement',
  REDLINE: 'Redline',
}

const FILTERS: Array<{ value: 'ALL' | SubmissionKind; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'COI', label: 'COI' },
  { value: 'WC', label: 'WC' },
  { value: 'AGREEMENT', label: 'Agreements' },
  { value: 'CC_AUTH', label: 'Card auth' },
  { value: 'REDLINE', label: 'Redlines' },
]

function fmtWhen(iso: string) {
  const d = new Date(iso)
  if (!d.getTime()) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  if (!d.getTime()) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function RecentSubmissions() {
  const [rows, setRows] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<'ALL' | SubmissionKind>('ALL')
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/paperwork/submissions?limit=50')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (d?.ok) setRows(d.submissions || [])
        else setError(d?.error || 'Could not load submissions')
      })
      .catch(() => {
        if (!cancelled) setError('Could not load submissions')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (kind !== 'ALL' && r.kind !== kind) return false
      if (!needle) return true
      return [r.jobName, r.jobCode, r.companyName, r.submittedBy, r.label, r.detail]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(needle))
    })
  }, [rows, kind, q])

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length }
    for (const r of rows) c[r.kind] = (c[r.kind] || 0) + 1
    return c
  }, [rows])

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Recent submissions</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            The last 50 pieces of client paperwork to land, across every job. Click one to open it
            on its job.
          </p>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search job, client, signer…"
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-56 focus:outline-none focus:border-gray-400"
        />
      </div>

      <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const n = counts[f.value] || 0
          const active = kind === f.value
          return (
            <button
              key={f.value}
              onClick={() => setKind(f.value)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                active
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
              <span className={active ? 'ml-1.5 text-gray-300' : 'ml-1.5 text-gray-400'}>{n}</span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">Loading…</div>
      ) : error ? (
        <div className="px-4 py-8 text-center text-xs text-red-600">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">
          {rows.length === 0
            ? 'No paperwork has been submitted yet.'
            : 'No submissions match that filter.'}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {filtered.map((r) => {
            const body = (
              <div className="flex items-start gap-3 px-4 py-3">
                <span
                  className={`mt-0.5 shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${KIND_BADGE[r.kind]}`}
                >
                  {KIND_SHORT[r.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-gray-900 truncate">
                    {r.label}
                    {r.detail && (
                      <span className="ml-2 font-normal text-gray-500">{r.detail}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                    {r.jobId ? (
                      <>
                        <span className="font-semibold text-gray-700">{r.jobName}</span>
                        {r.jobCode && <span className="text-gray-400"> · {r.jobCode}</span>}
                      </>
                    ) : (
                      <span className="text-amber-700">
                        Not attached to a job
                        {r.companyName ? ` · ${r.companyName}` : ''}
                      </span>
                    )}
                    {r.submittedBy && <span className="text-gray-400"> · {r.submittedBy}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[11px] text-gray-600">{fmtWhen(r.submittedAt)}</div>
                  <div className="text-[10px] text-gray-400">{fmtTime(r.submittedAt)}</div>
                </div>
              </div>
            )
            return (
              <li key={r.key}>
                {r.href ? (
                  <Link href={r.href} className="block hover:bg-gray-50 transition-colors">
                    {body}
                  </Link>
                ) : (
                  <div className="opacity-80">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
