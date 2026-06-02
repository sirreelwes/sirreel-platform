'use client'

/**
 * Jobs — list view.
 *
 * UI on the existing `GET /api/jobs`. Status chips drive the `statuses`
 * param; the `Orphans` chip uses the server-side `orphans=1` filter
 * (QUOTED jobs with no sent/durable order — surfaces abandoned quotes).
 * Search hits jobName + jobCode; `Mine` flips `mine=1`.
 *
 * Rows link to the existing `/jobs/[id]` detail page.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

const JOB_STATUSES = ['QUOTED', 'ACTIVE', 'WRAPPED', 'HOLD', 'LOST'] as const
type JobStatus = (typeof JOB_STATUSES)[number]

type Filter = 'all' | JobStatus | 'orphans'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'QUOTED', label: 'Quoted' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'HOLD', label: 'Hold' },
  { id: 'WRAPPED', label: 'Wrapped' },
  { id: 'LOST', label: 'Lost' },
  { id: 'orphans', label: 'Orphans' },
]

const STATUS_BADGE: Record<JobStatus, string> = {
  QUOTED:  'bg-purple-900/40 text-purple-300 border-purple-800',
  ACTIVE:  'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  WRAPPED: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  HOLD:    'bg-amber-900/40 text-amber-300 border-amber-800',
  LOST:    'bg-red-900/40 text-red-300 border-red-800',
}

// Phase 7 — paperwork rollup shape returned by /api/jobs. See
// rollupAgreementState / rollupCoiState in the route for state derivation.
type AgreementRollupState = 'NONE' | 'DRAFT' | 'SENT' | 'PARTIAL' | 'SIGNED'
type CoiRollupState = 'NONE' | 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'ISSUE'

interface PaperworkRollup {
  rental: { state: AgreementRollupState; count: number }
  stage: { state: AgreementRollupState; count: number } | null
  coi: { state: CoiRollupState; expiresAt?: string | null }
}

interface JobRow {
  id: string
  jobCode: string
  name: string
  status: JobStatus
  startDate: string | null
  endDate: string | null
  orderTotal: number
  estimatedValue: number | null
  company: { id: string; name: string } | null
  agent: { id: string; name: string } | null
  primaryContact: {
    firstName: string
    lastName: string
    email: string
    role: string
    isPrimary: boolean
  } | null
  paperwork?: PaperworkRollup
  _count?: { orders: number }
}

// Chip color per rollup state. Goal: agent scans the column, "Signed"
// reads as good, "Sent" + "Partially Signed" as in-flight, "None" as
// muted, "Issue" / "Expired" as urgent.
const AGREEMENT_CHIP: Record<AgreementRollupState, { label: string; cls: string }> = {
  NONE:    { label: 'None',              cls: 'bg-zinc-900 text-zinc-600 border-zinc-800' },
  DRAFT:   { label: 'Draft',             cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
  SENT:    { label: 'Sent',              cls: 'bg-blue-950/40 text-blue-300 border-blue-900' },
  PARTIAL: { label: 'Partially Signed',  cls: 'bg-amber-950/40 text-amber-300 border-amber-900' },
  SIGNED:  { label: 'Signed',            cls: 'bg-emerald-950/40 text-emerald-300 border-emerald-900' },
}

const COI_CHIP: Record<CoiRollupState, { label: string; cls: string }> = {
  NONE:     { label: 'None',     cls: 'bg-zinc-900 text-zinc-600 border-zinc-800' },
  PENDING:  { label: 'Pending',  cls: 'bg-amber-950/40 text-amber-300 border-amber-900' },
  VERIFIED: { label: 'Verified', cls: 'bg-emerald-950/40 text-emerald-300 border-emerald-900' },
  EXPIRED:  { label: 'Expired',  cls: 'bg-red-950/40 text-red-300 border-red-900' },
  ISSUE:    { label: 'Issue',    cls: 'bg-red-950/40 text-red-300 border-red-900' },
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function fmtMoney(n: number | null | undefined) {
  if (n == null || n === 0) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function JobsListPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [mine, setMine] = useState(false)
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    const params = new URLSearchParams()
    if (filter === 'orphans') params.set('orphans', '1')
    else if (filter !== 'all') params.set('status', filter)
    if (mine) params.set('mine', '1')
    if (debouncedSearch) params.set('search', debouncedSearch)

    setLoading(true)
    setError(null)
    fetch(`/api/jobs?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setJobs(d.jobs || [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [filter, mine, debouncedSearch])

  const countLabel = useMemo(() => {
    if (loading) return 'Loading…'
    if (error) return error
    return `${jobs.length} job${jobs.length === 1 ? '' : 's'}`
  }, [loading, error, jobs.length])

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Jobs</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Productions and quotes that own one or more Orders. Click a row for detail.
          </p>
        </div>
        <Link
          href="/orders/new-quote"
          className="text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg"
        >
          + New quote
        </Link>
      </header>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by job, code, company, or contact…"
            className="flex-1 min-w-[240px] px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500"
          />
          <label className="flex items-center gap-1.5 text-xs text-zinc-400 px-2 py-1">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
              className="accent-amber-500"
            />
            Mine only
          </label>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filter === f.id
                  ? 'bg-white text-zinc-900 border-white'
                  : 'bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500 hover:text-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-zinc-500">{countLabel}</span>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-950/40">
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2.5">Code</th>
              <th className="px-3 py-2.5">Job</th>
              <th className="px-3 py-2.5">Client</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Dates</th>
              <th className="px-3 py-2.5">Primary contact</th>
              <th className="px-3 py-2.5">Agent</th>
              <th className="px-3 py-2.5 text-right">Orders</th>
              <th className="px-3 py-2.5 text-right">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {jobs.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-zinc-500 text-sm">
                  {filter === 'orphans'
                    ? 'No abandoned QUOTED jobs. Good housekeeping.'
                    : 'No jobs match.'}
                </td>
              </tr>
            )}
            {jobs.map((j) => {
              const value = j.orderTotal > 0 ? j.orderTotal : j.estimatedValue
              // Phase 7 — paperwork sub-row visibility. Hidden entirely
              // when no paperwork exists in any slot to avoid stuffing
              // "No paperwork yet." under every QUOTED-shell row.
              const paperwork = j.paperwork
              const hasAnyPaperwork =
                !!paperwork &&
                (paperwork.rental.state !== 'NONE' ||
                  (paperwork.stage && paperwork.stage.state !== 'NONE') ||
                  paperwork.coi.state !== 'NONE')
              return (
                <Fragment key={j.id}>
                  <tr className="hover:bg-zinc-800/40 transition-colors border-b-0">
                    <td className="px-3 pt-2.5 pb-1 font-mono text-xs text-zinc-400 whitespace-nowrap">
                      <Link href={`/jobs/${j.id}`} className="hover:text-amber-400">
                        {j.jobCode}
                      </Link>
                    </td>
                    <td className="px-3 pt-2.5 pb-1">
                      <Link href={`/jobs/${j.id}`} className="text-zinc-100 hover:text-amber-400 font-medium">
                        {j.name}
                      </Link>
                    </td>
                    <td className="px-3 pt-2.5 pb-1 text-zinc-300 truncate max-w-[200px]">
                      {j.company?.name || '—'}
                    </td>
                    <td className="px-3 pt-2.5 pb-1">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${STATUS_BADGE[j.status]}`}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td className="px-3 pt-2.5 pb-1 text-xs text-zinc-400 whitespace-nowrap">
                      {fmtDate(j.startDate)} – {fmtDate(j.endDate)}
                    </td>
                    <td className="px-3 pt-2.5 pb-1 text-xs text-zinc-300">
                      {j.primaryContact ? (
                        <>
                          <div className="truncate max-w-[180px]">
                            {j.primaryContact.firstName} {j.primaryContact.lastName}
                            <span className="ml-1.5 text-[9px] font-semibold uppercase text-zinc-500">
                              {j.primaryContact.role}
                            </span>
                          </div>
                        </>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-3 pt-2.5 pb-1 text-xs text-zinc-400 truncate max-w-[140px]">
                      {j.agent?.name || '—'}
                    </td>
                    <td className="px-3 pt-2.5 pb-1 text-right text-xs text-zinc-300 font-mono">
                      {j._count?.orders ?? '—'}
                    </td>
                    <td className="px-3 pt-2.5 pb-1 text-right text-xs text-zinc-100 font-mono whitespace-nowrap">
                      {fmtMoney(value)}
                      {j.orderTotal === 0 && j.estimatedValue != null && (
                        <span className="ml-1 text-[9px] text-zinc-500 uppercase">est</span>
                      )}
                    </td>
                  </tr>
                  <tr className="hover:bg-zinc-800/40 transition-colors">
                    <td colSpan={9} className="px-3 pb-2 pt-0">
                      <PaperworkChips paperwork={paperwork} hasAny={hasAnyPaperwork} />
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Phase 7 — sub-row chip strip. Compact, muted; reads as a second
// line on each job row. Hidden chips for paperwork that doesn't exist
// at all (no NONE chips when nothing has even been started).
function PaperworkChips({
  paperwork,
  hasAny,
}: {
  paperwork: PaperworkRollup | undefined
  hasAny: boolean
}) {
  if (!paperwork || !hasAny) {
    return <div className="text-[10px] text-zinc-600 italic">No paperwork yet.</div>
  }

  const expiryLabel = paperwork.coi.expiresAt
    ? new Date(paperwork.coi.expiresAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: '2-digit',
      })
    : null

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
      {paperwork.rental.state !== 'NONE' && (
        <Chip label="Rental" state={AGREEMENT_CHIP[paperwork.rental.state]} />
      )}
      {paperwork.stage && paperwork.stage.state !== 'NONE' && (
        <Chip label="Stage" state={AGREEMENT_CHIP[paperwork.stage.state]} />
      )}
      {paperwork.coi.state !== 'NONE' && (
        <Chip
          label="COI"
          state={COI_CHIP[paperwork.coi.state]}
          tail={
            expiryLabel && paperwork.coi.state !== 'ISSUE'
              ? `exp ${expiryLabel}`
              : null
          }
        />
      )}
    </div>
  )
}

function Chip({
  label,
  state,
  tail,
}: {
  label: string
  state: { label: string; cls: string }
  tail?: string | null
}) {
  return (
    <span
      className={`inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded border ${state.cls}`}
    >
      <span className="font-semibold uppercase tracking-wider opacity-70">{label}</span>
      <span className="font-semibold">{state.label}</span>
      {tail && <span className="opacity-60">· {tail}</span>}
    </span>
  )
}
