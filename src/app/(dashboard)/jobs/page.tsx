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

// Phase 7 — operational cadence replaces the raw JobStatus pill on
// the list. Each cadence state has a label, a tinted pill (bg/fg),
// and a saturated left-edge bar tint. Static class strings so
// Tailwind's content scanner sees them.
type CadenceState =
  | 'quoted'
  | 'hold'
  | 'lost'
  | 'booked'
  | 'picking-tmw'
  | 'picking-today'
  | 'on-rental'
  | 'returning-tmw'
  | 'returning-today'
  | 'returned'
  | 'invoiced'
  | 'wrapped'

const CADENCE_LABEL: Record<CadenceState, string> = {
  quoted:          'Quoted',
  hold:            'Hold',
  lost:            'Lost',
  booked:          'Booked',
  'picking-tmw':   'Picking up tomorrow',
  'picking-today': 'Picking up today',
  'on-rental':     'On rental',
  'returning-tmw': 'Returning tomorrow',
  'returning-today':'Returning today',
  returned:        'Returned',
  invoiced:        'Invoiced',
  wrapped:         'Wrapped',
}

const CADENCE_PILL: Record<CadenceState, string> = {
  quoted:          'bg-pill-quoted-bg text-pill-quoted-fg',
  hold:            'bg-pill-hold-bg text-pill-hold-fg',
  lost:            'bg-pill-lost-bg text-pill-lost-fg',
  booked:          'bg-cadence-booked-bg text-cadence-booked-fg',
  'picking-tmw':   'bg-cadence-picking-tmw-bg text-cadence-picking-tmw-fg',
  'picking-today': 'bg-cadence-picking-today-bg text-cadence-picking-today-fg',
  'on-rental':     'bg-cadence-on-rental-bg text-cadence-on-rental-fg',
  'returning-tmw': 'bg-cadence-returning-tmw-bg text-cadence-returning-tmw-fg',
  'returning-today':'bg-cadence-returning-today-bg text-cadence-returning-today-fg',
  returned:        'bg-cadence-returned-bg text-cadence-returned-fg',
  invoiced:        'bg-cadence-invoiced-bg text-cadence-invoiced-fg',
  wrapped:         'bg-cadence-wrapped-bg text-cadence-wrapped-fg',
}

// Edge bar uses the saturated `-bar` variant as a border-color. Each
// class is a static literal so Tailwind's content scanner picks them
// up. Pre-booked rows share one muted bar (`cadence-pre-bar`) since
// their pill already carries the commercial color in `pill.*`.
const CADENCE_BAR: Record<CadenceState, string> = {
  quoted:          'border-cadence-pre-bar',
  hold:            'border-cadence-pre-bar',
  lost:            'border-cadence-pre-bar',
  booked:          'border-cadence-booked-bar',
  'picking-tmw':   'border-cadence-picking-tmw-bar',
  'picking-today': 'border-cadence-picking-today-bar',
  'on-rental':     'border-cadence-on-rental-bar',
  'returning-tmw': 'border-cadence-returning-tmw-bar',
  'returning-today':'border-cadence-returning-today-bar',
  returned:        'border-cadence-returned-bar',
  invoiced:        'border-cadence-invoiced-bar',
  wrapped:         'border-cadence-wrapped-bar',
}

interface CadenceRollup {
  state: CadenceState
  partial: boolean
}

// Phase 7 — paperwork rollup shape returned by /api/jobs. See
// rollupAgreementState / rollupCoiState in the route for state derivation.
type AgreementRollupState = 'NONE' | 'DRAFT' | 'SENT' | 'PARTIAL' | 'SIGNED'
type CoiRollupState = 'NONE' | 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'ISSUE'
// Phase 7 — billing rollup. Derived from the reconciled Invoice columns
// only (status / balanceDue / total / dueDate). PENDING/SETTLED ACH
// never bleeds into "paid" because reconcileInvoiceTotals counts
// CLEARED-only when it writes amountPaid + balanceDue.
type BillingRollupState =
  | 'NOT_INVOICED'
  | 'DRAFT'
  | 'SENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'

interface PaperworkRollup {
  rental: { state: AgreementRollupState; count: number }
  stage: { state: AgreementRollupState; count: number } | null
  coi: { state: CoiRollupState; expiresAt?: string | null }
}

interface BillingRollup {
  state: BillingRollupState
  balanceDue: number
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
  billing?: BillingRollup
  cadence?: CadenceRollup
  hasLD?: boolean
  blindPickup?: boolean
  blindReturn?: boolean
  _count?: { orders: number }
}

// Light-motif chip palette. Per spec: paperwork chips read neutral
// regardless of state — the agent uses the *label* to scan ("Signed"
// vs "Sent" vs "Partially Signed"), not the color. Color is reserved
// for billing where money-state urgency is what the eye should grab.
const AGREEMENT_CHIP: Record<AgreementRollupState, { label: string; cls: string }> = {
  NONE:    { label: 'None',              cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  DRAFT:   { label: 'Draft',             cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  SENT:    { label: 'Sent',              cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  PARTIAL: { label: 'Partially Signed',  cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  SIGNED:  { label: 'Signed',            cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
}

const COI_CHIP: Record<CoiRollupState, { label: string; cls: string }> = {
  NONE:     { label: 'None',     cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  PENDING:  { label: 'Pending',  cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  VERIFIED: { label: 'Verified', cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  EXPIRED:  { label: 'Expired',  cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  ISSUE:    { label: 'Issue',    cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
}

// Billing carries the urgency in this design. NOT_INVOICED renders
// as a dashed muted tag (different shape, not a tint) so a fresh-quote
// row still reads in the scan without competing for color attention.
const BILLING_CHIP: Record<BillingRollupState, { label: string; cls: string }> = {
  NOT_INVOICED:    { label: 'Not invoiced',    cls: 'border border-dashed border-chip-muted-border text-chip-muted-fg' },
  DRAFT:           { label: 'Draft',           cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  SENT:            { label: 'Sent',            cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  PARTIALLY_PAID:  { label: 'Partially paid',  cls: 'bg-chip-warn-bg text-chip-warn-fg' },
  PAID:            { label: 'Paid',            cls: 'bg-chip-good-bg text-chip-good-fg' },
  OVERDUE:         { label: 'Overdue',         cls: 'bg-chip-bad-bg text-chip-bad-fg' },
}

// Map cadence state → label, with the partial-return modifier applied
// when the rollup flagged it. Partial replaces only the inbound return
// labels — pickup/on-rental events are never partial.
function formatCadenceLabel(state: CadenceState, partial: boolean): string {
  if (!partial) return CADENCE_LABEL[state]
  if (state === 'returning-today') return 'Partial return · today'
  if (state === 'returning-tmw')   return 'Partial return · tomorrow'
  if (state === 'returned')        return 'Partial returned'
  return CADENCE_LABEL[state]
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
    // Phase 7 — light-motif pilot. Page bg overrides the shell's
    // default until the rollout converts the rest of the app. Token
    // names are additive (`lt-*`, `pill-*`, `chip-*`) so unconverted
    // pages stay untouched.
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-7xl mx-auto space-y-4">
        <header className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-lt-fg">Jobs</h1>
            <p className="text-sm text-lt-fg2 mt-0.5">
              Productions and quotes that own one or more Orders. Click a row for detail.
            </p>
          </div>
          <Link
            href="/orders/new-quote"
            className="text-xs font-semibold bg-lt-fg hover:bg-black text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            + New quote
          </Link>
        </header>

        <div className="bg-lt-card border border-lt-hairline rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by job, code, company, or contact…"
              className="flex-1 min-w-[240px] px-3 py-1.5 bg-lt-card border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg2"
            />
            <label className="flex items-center gap-1.5 text-xs text-lt-fg2 px-2 py-1">
              <input
                type="checkbox"
                checked={mine}
                onChange={(e) => setMine(e.target.checked)}
                className="accent-lt-fg"
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
                    ? 'bg-lt-fg text-white border-lt-fg'
                    : 'bg-lt-card text-lt-fg2 border-lt-hairline hover:border-lt-fg2 hover:text-lt-fg'
                }`}
              >
                {f.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-lt-fg3">{countLabel}</span>
          </div>
        </div>

        <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-lt-inner">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-lt-fg3">
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
            <tbody className="divide-y divide-lt-hairline">
              {jobs.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-lt-fg3 text-sm">
                    {filter === 'orphans'
                      ? 'No abandoned QUOTED jobs. Good housekeeping.'
                      : 'No jobs match.'}
                  </td>
                </tr>
              )}
              {jobs.map((j) => {
                const value = j.orderTotal > 0 ? j.orderTotal : j.estimatedValue
                // Sub-row content. The billing chip always renders
                // (NOT_INVOICED is meaningful information), so there's
                // no "empty sub-row" case. Paperwork chips drop out
                // when their slot is empty.
                const paperwork = j.paperwork
                const billing = j.billing
                // Cadence rollup drives the left-edge bar + the merged
                // status label. Server falls back to JobStatus for
                // pre-booked Jobs (quoted/hold/lost) and short-circuits
                // wrapped Jobs.
                const cadenceState: CadenceState = j.cadence?.state ?? (
                  j.status === 'QUOTED' ? 'quoted'
                    : j.status === 'HOLD' ? 'hold'
                    : j.status === 'LOST' ? 'lost'
                    : j.status === 'WRAPPED' ? 'wrapped'
                    : 'booked'
                )
                const partial = !!j.cadence?.partial
                const cadenceLabel = formatCadenceLabel(cadenceState, partial)
                const barCls = CADENCE_BAR[cadenceState]
                return (
                  <Fragment key={j.id}>
                    <tr className="hover:bg-lt-inner transition-colors border-b-0">
                      <td className={`pl-2 pr-3 pt-2.5 pb-1 font-mono text-xs text-lt-fg3 whitespace-nowrap border-l-4 ${barCls}`}>
                        <Link href={`/jobs/${j.id}`} className="hover:text-lt-fg">
                          {j.jobCode}
                        </Link>
                      </td>
                      <td className="px-3 pt-2.5 pb-1">
                        <Link href={`/jobs/${j.id}`} className="text-lt-fg hover:text-black font-medium inline-flex items-center gap-1.5">
                          {j.name}
                          {j.hasLD && (
                            <span
                              className="text-chip-bad-fg text-[10px] leading-none"
                              title="Loss & Damage claim open"
                              aria-label="L&D claim open"
                            >
                              ▲
                            </span>
                          )}
                          {/* Blind handoff markers — eye-off glyphs sit
                              next to the job name when any order on the
                              job carries the flag. Two distinct icons
                              so an agent can tell pickup vs return at a
                              glance without hovering. */}
                          {j.blindPickup && (
                            <span
                              className="text-lt-fg2 text-[11px] leading-none"
                              title="Blind pickup — client picks up the unit themselves"
                              aria-label="Blind pickup"
                            >
                              ⊘↗
                            </span>
                          )}
                          {j.blindReturn && (
                            <span
                              className="text-lt-fg2 text-[11px] leading-none"
                              title="Blind return — client returns the unit themselves"
                              aria-label="Blind return"
                            >
                              ⊘↙
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-3 pt-2.5 pb-1 text-lt-fg2 truncate max-w-[200px]">
                        {j.company?.name || '—'}
                      </td>
                      <td className="px-3 pt-2.5 pb-1">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${CADENCE_PILL[cadenceState]}`}
                        >
                          {partial && (
                            <span className="text-[11px] leading-none" aria-hidden="true">◐</span>
                          )}
                          {cadenceLabel}
                        </span>
                      </td>
                      <td className="px-3 pt-2.5 pb-1 text-xs text-lt-fg2 whitespace-nowrap">
                        {fmtDate(j.startDate)} – {fmtDate(j.endDate)}
                      </td>
                      <td className="px-3 pt-2.5 pb-1 text-xs text-lt-fg2">
                        {j.primaryContact ? (
                          <div className="truncate max-w-[180px]">
                            {j.primaryContact.firstName} {j.primaryContact.lastName}
                            <span className="ml-1.5 text-[9px] font-semibold uppercase text-lt-fg3">
                              {j.primaryContact.role}
                            </span>
                          </div>
                        ) : (
                          <span className="text-lt-fg3">—</span>
                        )}
                      </td>
                      <td className="px-3 pt-2.5 pb-1 text-xs text-lt-fg2 truncate max-w-[140px]">
                        {j.agent?.name || '—'}
                      </td>
                      <td className="px-3 pt-2.5 pb-1 text-right text-xs text-lt-fg2 font-mono">
                        {j._count?.orders ?? '—'}
                      </td>
                      <td className="px-3 pt-2.5 pb-1 text-right text-xs text-lt-fg font-mono whitespace-nowrap">
                        {fmtMoney(value)}
                        {j.orderTotal === 0 && j.estimatedValue != null && (
                          <span className="ml-1 text-[9px] text-lt-fg3 uppercase">est</span>
                        )}
                      </td>
                    </tr>
                    <tr className="hover:bg-lt-inner transition-colors">
                      <td
                        colSpan={9}
                        className={`pl-2 pr-3 pb-2 pt-0 border-l-4 ${barCls}`}
                      >
                        <SubRowChips paperwork={paperwork} billing={billing} />
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Phase 7 — sub-row chip strip. Compact, muted; reads as a second
// line on each job row. Paperwork chips drop out when their slot is
// empty; the billing chip always renders since NOT_INVOICED is itself
// useful information for a triage scan.
function SubRowChips({
  paperwork,
  billing,
}: {
  paperwork: PaperworkRollup | undefined
  billing: BillingRollup | undefined
}) {
  const expiryLabel = paperwork?.coi.expiresAt
    ? new Date(paperwork.coi.expiresAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: '2-digit',
      })
    : null

  // Billing chip tail. Show "$X due" when there's a positive balance,
  // and omit the "Billing:" label entirely for NOT_INVOICED — the chip
  // reads as a standalone "Not invoiced" tag.
  const billingTail =
    billing && billing.balanceDue > 0
      ? `${fmtMoney(billing.balanceDue)} due`
      : null
  const billingLabel = billing && billing.state === 'NOT_INVOICED' ? null : 'Billing'

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
      {paperwork?.rental.state && paperwork.rental.state !== 'NONE' && (
        <Chip label="Rental" state={AGREEMENT_CHIP[paperwork.rental.state]} />
      )}
      {paperwork?.stage && paperwork.stage.state !== 'NONE' && (
        <Chip label="Stage" state={AGREEMENT_CHIP[paperwork.stage.state]} />
      )}
      {paperwork?.coi.state && paperwork.coi.state !== 'NONE' && (
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
      {billing && (
        <Chip label={billingLabel} state={BILLING_CHIP[billing.state]} tail={billingTail} />
      )}
    </div>
  )
}

function Chip({
  label,
  state,
  tail,
}: {
  label: string | null
  state: { label: string; cls: string }
  tail?: string | null
}) {
  // The base wrapper has no border by default — tinted chips don't
  // need one. The NOT_INVOICED billing chip opts back in with a
  // dashed border via its `cls`, which is why we don't force `border`
  // here as a class baseline.
  return (
    <span
      className={`inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded ${state.cls}`}
    >
      {label && (
        <span className="font-semibold uppercase tracking-wider opacity-70">{label}</span>
      )}
      <span className="font-semibold">{state.label}</span>
      {tail && <span className="opacity-70">· {tail}</span>}
    </span>
  )
}
