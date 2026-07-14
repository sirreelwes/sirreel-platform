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

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

const JOB_STATUSES = ['NEW', 'QUOTED', 'ACTIVE', 'WRAPPED', 'HOLD', 'LOST'] as const
type JobStatus = (typeof JOB_STATUSES)[number]

type Filter = 'all' | JobStatus | 'orphans'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'NEW', label: 'New' },
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
  | 'new'
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
  new:             'New',
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
  new:             'bg-sky-100 text-sky-700',
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
  new:             'border-sky-400',
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

// Semantic chip variants — the three paperwork buttons share this
// vocabulary so the agent eye reads "good / pending / problem /
// missing" at a glance regardless of which doc slot they're scanning.
type ChipTone = 'good' | 'warn' | 'bad' | 'missing'

const TONE_CLS: Record<ChipTone, string> = {
  good:    'bg-chip-good-bg text-chip-good-fg',
  warn:    'bg-chip-warn-bg text-chip-warn-fg',
  bad:     'bg-chip-bad-bg text-chip-bad-fg',
  missing: 'border border-dashed border-chip-muted-border text-chip-muted-fg',
}

// Unicode icons by tone. Stays cross-platform and a11y-readable
// (the chip's title attr describes the state in words).
const TONE_ICON: Record<ChipTone, string> = {
  good:    '✓',
  warn:    '⏱',
  bad:     '⚠',
  missing: '−',
}

interface JobRow {
  id: string
  jobCode: string
  name: string
  status: JobStatus
  startDate: string | null
  createdAt: string
  endDate: string | null
  orderTotal: number
  estimatedValue: number | null
  company: { id: string; name: string } | null
  agent: { id: string; name: string } | null
  primaryContact: {
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    role: string
    isPrimary: boolean
  } | null
  paperwork?: PaperworkRollup
  billing?: BillingRollup
  cadence?: CadenceRollup
  hasLD?: boolean
  // Stage-scope marker — when true the Stage Contract paperwork
  // button renders alongside Rental + COI; otherwise it's hidden.
  // Set server-side from stageBookingTerms presence OR an existing
  // STAGE_CONTRACT agreement.
  hasStageScope?: boolean
  blindPickup?: boolean
  blindReturn?: boolean
  _count?: { orders: number }
}

// Color-coded paperwork buttons (replaces the prior all-neutral
// flatten). Each enum state maps to a label + a semantic tone:
//   SIGNED → good (green + ✓), pre-signed in-progress states → warn
//   (amber + ⏱), NONE → missing (grey dashed + −). COI adds a `bad`
//   branch for EXPIRED / rejected — the others can't fail-out.
const AGREEMENT_CHIP: Record<AgreementRollupState, { label: string; tone: ChipTone }> = {
  NONE:    { label: 'None',              tone: 'missing' },
  DRAFT:   { label: 'Draft',             tone: 'warn'    },
  SENT:    { label: 'Sent',              tone: 'warn'    },
  PARTIAL: { label: 'Partially Signed',  tone: 'warn'    },
  SIGNED:  { label: 'Signed',            tone: 'good'    },
}

const COI_CHIP: Record<CoiRollupState, { label: string; tone: ChipTone }> = {
  NONE:     { label: 'None',     tone: 'missing' },
  PENDING:  { label: 'Pending',  tone: 'warn'    },
  VERIFIED: { label: 'Verified', tone: 'good'    },
  EXPIRED:  { label: 'Expired',  tone: 'bad'     },
  ISSUE:    { label: 'Issue',    tone: 'bad'     },
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

        {/* Jobs list — roomy stacked rows. The earlier 9-column table
            was dense and required column-header scanning; the list
            puts the agent's three core questions per job (what is it,
            where in the cadence, what does paperwork+billing look
            like) on three distinct visual lanes. Full-height left
            cadence bar; whole row clickable as a Link. */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden divide-y divide-lt-hairline">
          {jobs.length === 0 && !loading && (
            <div className="px-4 py-8 text-center text-lt-fg3 text-sm">
              {filter === 'orphans'
                ? 'No abandoned QUOTED jobs. Good housekeeping.'
                : 'No jobs match.'}
            </div>
          )}
          {jobs.map((j) => {
            const value = j.orderTotal > 0 ? j.orderTotal : j.estimatedValue
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
            const orderCount = j._count?.orders ?? 0
            return (
              <Link
                key={j.id}
                href={`/jobs/${j.id}`}
                className={`flex items-stretch hover:bg-lt-inner transition-colors border-l-4 ${barCls}`}
              >
                <div className="flex-1 min-w-0 pl-4 pr-4 py-3 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Line 1: code above title; title = "Job · Client".
                        Inline icon badges (blind + L&D) follow the title. */}
                    <div className="text-[10px] font-mono uppercase tracking-wider text-lt-fg3">
                      {j.jobCode}
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-[15px] font-medium text-lt-fg leading-tight">
                        {j.name}
                        {j.company?.name && (
                          <>
                            <span className="text-lt-fg3 font-normal"> · </span>
                            <span className="text-lt-fg2 font-normal">{j.company.name}</span>
                          </>
                        )}
                      </span>
                      {j.hasLD && (
                        <span
                          className="text-chip-bad-fg text-[10px] leading-none"
                          title="Loss & Damage claim open"
                          aria-label="L&D claim open"
                        >
                          ▲
                        </span>
                      )}
                      {/* Blind handoff markers. Eye-off glyphs sit
                          inline after the title so an agent can tell
                          pickup vs return at a glance without hover. */}
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
                    </div>

                    {/* Metadata: client · contact (role) · N order(s) · agent.
                        Renders as a single muted line that wraps on narrow
                        viewports. The client appears here as the canonical
                        full name (the title's version may be visually
                        de-emphasized but this line is the metadata source). */}
                    <div className="mt-1 text-[11.5px] text-lt-fg2 flex items-center gap-1.5 flex-wrap leading-snug">
                      <span className="text-lt-fg2">{j.company?.name || '—'}</span>
                      <span className="text-lt-fg3">·</span>
                      {j.primaryContact ? (
                        <span>
                          {j.primaryContact.firstName} {j.primaryContact.lastName}
                          <span className="ml-1 text-[10px] text-lt-fg3 uppercase tracking-wider">({j.primaryContact.role})</span>
                        </span>
                      ) : (
                        <span className="text-lt-fg3">no contact</span>
                      )}
                      <span className="text-lt-fg3">·</span>
                      <span>{orderCount} order{orderCount === 1 ? '' : 's'}</span>
                      <span className="text-lt-fg3">·</span>
                      <span>{j.agent?.name || '—'}</span>
                    </div>

                    {/* Job-as-root step 1 — NEW rows work as a lead queue:
                        contact reachability, age, and a next-action hint. */}
                    {j.status === 'NEW' && (
                      <div className="mt-1 text-[11px] flex items-center gap-1.5 flex-wrap leading-snug">
                        {j.primaryContact?.email && <span className="text-lt-fg2">{j.primaryContact.email}</span>}
                        {j.primaryContact?.phone && (
                          <>
                            <span className="text-lt-fg3">·</span>
                            <span className="text-lt-fg2">{j.primaryContact.phone}</span>
                          </>
                        )}
                        {(j.primaryContact?.email || j.primaryContact?.phone) && <span className="text-lt-fg3">·</span>}
                        <span className="text-lt-fg3">
                          {(() => {
                            const days = Math.floor((Date.now() - new Date(j.createdAt).getTime()) / 86_400_000)
                            return days === 0 ? 'today' : `${days}d old`
                          })()}
                        </span>
                        <span className="text-lt-fg3">·</span>
                        <span className="font-semibold text-sky-700">
                          {!j.startDate ? 'needs dates' : orderCount === 0 ? 'needs quote' : 'ready to quote'}
                        </span>
                      </div>
                    )}

                    {/* Sub-row: paperwork buttons + billing chip. The
                        component reads everything it needs off the
                        rollups; tones are state-keyed. */}
                    <div className="mt-2">
                      <SubRowChips
                        paperwork={j.paperwork}
                        billing={j.billing}
                        hasStageScope={!!j.hasStageScope}
                      />
                    </div>
                  </div>

                  {/* Right side: stacked status pill above the $value.
                      Right-aligned, doesn't shrink. */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${CADENCE_PILL[cadenceState]}`}
                    >
                      {partial && (
                        <span className="text-[11px] leading-none" aria-hidden="true">◐</span>
                      )}
                      {cadenceLabel}
                    </span>
                    <span className="text-[14px] font-mono font-medium text-lt-fg whitespace-nowrap">
                      {fmtMoney(value)}
                      {j.orderTotal === 0 && j.estimatedValue != null && (
                        <span className="ml-1 text-[9px] text-lt-fg3 uppercase">est</span>
                      )}
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
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
  hasStageScope,
}: {
  paperwork: PaperworkRollup | undefined
  billing: BillingRollup | undefined
  hasStageScope: boolean
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

  // Rental + COI render unconditionally — a missing one is meaningful
  // information for triage and reads as the dashed-grey "missing" tone.
  // Stage hides entirely on jobs with no stage component so non-stage
  // rows stay clean.
  const rentalState = paperwork?.rental.state ?? 'NONE'
  const coiState = paperwork?.coi.state ?? 'NONE'
  const stageState = paperwork?.stage?.state ?? 'NONE'

  const rentalChip = AGREEMENT_CHIP[rentalState]
  const stageChip = AGREEMENT_CHIP[stageState]
  const coiChip = COI_CHIP[coiState]

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
      <Chip
        label="Rental"
        valueLabel={rentalChip.label}
        tone={rentalChip.tone}
        title={`Rental agreement: ${rentalChip.label}`}
      />
      {hasStageScope && (
        <Chip
          label="Stage"
          valueLabel={stageChip.label}
          tone={stageChip.tone}
          title={`Stage contract: ${stageChip.label}`}
        />
      )}
      <Chip
        label="COI"
        valueLabel={coiChip.label}
        tone={coiChip.tone}
        tail={
          expiryLabel && coiState !== 'EXPIRED' && coiState !== 'ISSUE'
            ? `exp ${expiryLabel}`
            : null
        }
        title={`Certificate of insurance: ${coiChip.label}${expiryLabel ? ` · exp ${expiryLabel}` : ''}`}
      />
      {billing && (
        <Chip
          label={billingLabel}
          valueLabel={BILLING_CHIP[billing.state].label}
          // Billing uses its own classed map (predates the tone
          // refactor) — pass `customCls` to skip the tone-class lookup
          // and stay visually distinct (no icon, "Billing ·" prefix).
          customCls={BILLING_CHIP[billing.state].cls}
          tail={billingTail}
        />
      )}
    </div>
  )
}

function Chip({
  label,
  valueLabel,
  tone,
  customCls,
  tail,
  title,
}: {
  label: string | null
  valueLabel: string
  tone?: ChipTone
  customCls?: string
  tail?: string | null
  title?: string
}) {
  // Paperwork buttons go through `tone` → TONE_CLS + TONE_ICON. The
  // billing chip predates the tone refactor and stays on its own
  // classed map via `customCls`. Exactly one path runs; the other is
  // a noop. Title attribute spells the state for hover + a11y.
  const cls = customCls ?? (tone ? TONE_CLS[tone] : '')
  const icon = tone ? TONE_ICON[tone] : null
  return (
    <span
      title={title}
      className={`inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded ${cls}`}
    >
      {icon && (
        <span className="font-bold leading-none" aria-hidden="true">{icon}</span>
      )}
      {label && (
        <span className="font-semibold uppercase tracking-wider opacity-70">{label}</span>
      )}
      <span className="font-semibold">{valueLabel}</span>
      {tail && <span className="opacity-70">· {tail}</span>}
    </span>
  )
}
