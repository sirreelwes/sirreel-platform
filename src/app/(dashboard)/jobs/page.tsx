'use client'

/**
 * Jobs — three-column kanban board (PREJOB / OUT / RETURNED).
 *
 * UI on the existing `GET /api/jobs`. Status chips drive the `statuses`
 * param; the `Orphans` chip uses the server-side `orphans=1` filter;
 * Search hits jobName + jobCode; `Mine` flips `mine=1`. All filters
 * apply over the board — cards render in whichever column they place.
 *
 * COLUMN PLACEMENT (real data, no fabrication):
 *   1. Manual override (sr_job_board_overrides side table) wins — the
 *      interim stand-in until checkout/check-in events exist. Those
 *      triggers will later replace the override writes entirely.
 *   2. Order-driven cadence (server rollup) when the job has live
 *      orders: picking-* → PREJOB, on-rental/returning-* → OUT,
 *      returned/invoiced → RETURNED.
 *   3. Date fallback (jobs with no orders — all Planyo imports today):
 *      Job.startDate/endDate, else the booking envelope from the API.
 *      end < today → RETURNED · start ≤ today ≤ end → OUT · else PREJOB.
 *   NEW/QUOTED/HOLD/LOST always sit in PREJOB; WRAPPED in RETURNED.
 *
 * Cards link to the existing `/jobs/[id]` detail page.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { NewJobLauncher } from '@/components/jobs/NewJobLauncher'

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
  // Board inputs (see docblock). bookingWindow = min/max across the
  // job's bookings; hasDelivery = any booking with a delivery address.
  bookingWindow?: { start: string | null; end: string | null } | null
  hasDelivery?: boolean
  boardPhaseOverride?: BoardColumn | null
}

// ─── Kanban board ────────────────────────────────────────────────

type BoardColumn = 'PREJOB' | 'OUT' | 'RETURNED'
const BOARD_COLUMNS: BoardColumn[] = ['PREJOB', 'OUT', 'RETURNED']

const COLUMN_META: Record<BoardColumn, { title: string; hint: string }> = {
  PREJOB:   { title: 'Prejob',   hint: 'quotes, leads & booked — nothing out yet' },
  OUT:      { title: 'Out',      hint: 'items with the client' },
  RETURNED: { title: 'Returned', hint: 'items back — closeout' },
}

// Effective window for date-derived placement: the Job's own dates,
// falling back to the booking envelope.
function jobWindow(j: JobRow): { start: string | null; end: string | null } {
  return {
    start: j.startDate?.slice(0, 10) ?? j.bookingWindow?.start ?? null,
    end: j.endDate?.slice(0, 10) ?? j.bookingWindow?.end ?? null,
  }
}

function deriveColumn(j: JobRow, today: string): BoardColumn {
  if (j.status === 'WRAPPED') return 'RETURNED'
  if (j.status !== 'ACTIVE') return 'PREJOB' // NEW / QUOTED / HOLD / LOST
  const c = j.cadence?.state
  if (c === 'on-rental' || c === 'returning-tmw' || c === 'returning-today') return 'OUT'
  if (c === 'returned' || c === 'invoiced') return 'RETURNED'
  if (c === 'picking-tmw' || c === 'picking-today') return 'PREJOB'
  // cadence 'booked' with real orders = genuinely future → PREJOB.
  if ((j._count?.orders ?? 0) > 0) return 'PREJOB'
  // No orders (Planyo imports) → place by dates. No dates → PREJOB
  // ("needs dates"), never OUT.
  const w = jobWindow(j)
  if (!w.start || !w.end) return 'PREJOB'
  if (w.end < today) return 'RETURNED'
  if (w.start <= today) return 'OUT'
  return 'PREJOB'
}

// OUT-column return urgency, from the order cadence when present,
// else the effective end date. green=active · orange=tomorrow · red=today.
type OutUrgency = 'active' | 'tomorrow' | 'today' | 'overdue'
function outUrgency(j: JobRow, today: string, tomorrow: string): OutUrgency {
  const c = j.cadence?.state
  if (c === 'returning-today') return 'today'
  if (c === 'returning-tmw') return 'tomorrow'
  if (c === 'on-rental') return 'active'
  const end = jobWindow(j).end
  if (!end) return 'active'
  if (end < today) return 'overdue'
  if (end === today) return 'today'
  if (end === tomorrow) return 'tomorrow'
  return 'active'
}

const OUT_BAND: Record<OutUrgency, string> = {
  active:   'border-emerald-400',
  tomorrow: 'border-orange-400',
  today:    'border-red-500',
  overdue:  'border-red-600',
}
const OUT_LABEL: Record<OutUrgency, string> = {
  active:   'On rental',
  tomorrow: 'Returning tomorrow',
  today:    'Returning today',
  overdue:  'Return overdue',
}
const OUT_PILL: Record<OutUrgency, string> = {
  active:   'bg-emerald-100 text-emerald-700',
  tomorrow: 'bg-orange-100 text-orange-700',
  today:    'bg-red-100 text-red-700',
  overdue:  'bg-red-200 text-red-800',
}

// PREJOB sub-state band (spec): yellow=NEW · orange=QUOTED ·
// teal=booked/ACTIVE-not-yet-out · muted for HOLD/LOST.
function prejobBand(j: JobRow): { band: string; label: string; pill: string } {
  switch (j.status) {
    case 'NEW':    return { band: 'border-yellow-400', label: 'New',    pill: 'bg-yellow-100 text-yellow-800' }
    case 'QUOTED': return { band: 'border-orange-400', label: 'Quoted', pill: 'bg-orange-100 text-orange-700' }
    case 'HOLD':   return { band: 'border-zinc-300',   label: 'Hold',   pill: 'bg-zinc-100 text-zinc-600' }
    case 'LOST':   return { band: 'border-zinc-200',   label: 'Lost',   pill: 'bg-zinc-100 text-zinc-400' }
    default: {
      const c = j.cadence?.state
      const label = c === 'picking-today' ? 'Picking up today' : c === 'picking-tmw' ? 'Picking up tomorrow' : 'Booked'
      return { band: 'border-teal-400', label, pill: 'bg-teal-100 text-teal-700' }
    }
  }
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

  // Board placement — today/tomorrow computed the same way the API's
  // cadence rollup does (UTC date strings compared against @db.Date).
  const { today, tomorrow } = useMemo(() => {
    const t = new Date()
    t.setUTCHours(0, 0, 0, 0)
    const tm = new Date(t)
    tm.setUTCDate(tm.getUTCDate() + 1)
    return { today: t.toISOString().slice(0, 10), tomorrow: tm.toISOString().slice(0, 10) }
  }, [])

  const placed = useMemo(
    () =>
      jobs.map((job) => {
        const derived = deriveColumn(job, today)
        const column: BoardColumn = (job.boardPhaseOverride as BoardColumn | null) ?? derived
        return { job, derived, column }
      }),
    [jobs, today],
  )

  // Manual move — writes the presentation-only override (or clears it
  // with phase null) and updates the card in place. This is where the
  // future checkout/check-in event triggers plug in instead.
  const [movingId, setMovingId] = useState<string | null>(null)
  const moveJob = async (job: JobRow, target: BoardColumn | null, _derived?: BoardColumn) => {
    setMovingId(job.id)
    try {
      const res = await fetch(`/api/jobs/${job.id}/board-phase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: target }),
      })
      if (res.ok) {
        setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, boardPhaseOverride: target } : j)))
      }
    } finally {
      setMovingId(null)
    }
  }

  return (
    // Phase 7 — light-motif pilot. Page bg overrides the shell's
    // default until the rollout converts the rest of the app. Token
    // names are additive (`lt-*`, `pill-*`, `chip-*`) so unconverted
    // pages stay untouched.
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-7xl mx-auto space-y-4">
        <header className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-lt-fg">Jobs</h1>
              <NewJobLauncher />
            </div>
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

        {/* Kanban board — three columns, cards = Jobs. Placement rules
            live in deriveColumn(); manual moves write the side-table
            override via POST /api/jobs/[id]/board-phase. */}
        {loading && jobs.length === 0 ? (
          <div className="bg-lt-card border border-lt-hairline rounded-xl px-4 py-8 text-center text-lt-fg3 text-sm">
            Loading…
          </div>
        ) : jobs.length === 0 ? (
          <div className="bg-lt-card border border-lt-hairline rounded-xl px-4 py-8 text-center text-lt-fg3 text-sm">
            {filter === 'orphans' ? 'No abandoned QUOTED jobs. Good housekeeping.' : 'No jobs match.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            {BOARD_COLUMNS.map((col) => {
              const colJobs = placed.filter((pj) => pj.column === col)
              return (
                <div key={col} className="bg-lt-inner/50 border border-lt-hairline rounded-xl">
                  <div className="px-3 pt-3 pb-2 flex items-baseline gap-2">
                    <h2 className="text-sm font-bold text-lt-fg uppercase tracking-wider">{COLUMN_META[col].title}</h2>
                    <span className="text-xs text-lt-fg3">{colJobs.length}</span>
                    <span className="ml-auto text-[10px] text-lt-fg3">{COLUMN_META[col].hint}</span>
                  </div>
                  <div className="px-2 pb-2 space-y-2">
                    {colJobs.length === 0 && (
                      <div className="px-2 py-6 text-center text-[11px] text-lt-fg3 border border-dashed border-lt-hairline rounded-lg">
                        Nothing here.
                      </div>
                    )}
                    {colJobs.map(({ job: j, derived }) => (
                      <JobCard
                        key={j.id}
                        job={j}
                        column={col}
                        derived={derived}
                        today={today}
                        tomorrow={tomorrow}
                        moving={movingId === j.id}
                        onMove={(target) => moveJob(j, target, derived)}
                      />
                    ))}
                    {/* FUTURE: the rich fleet/warehouse check-in icon
                        language lands here once check-in data exists —
                        deliberately not fabricated from today's data. */}
                    {col === 'RETURNED' && colJobs.length > 0 && (
                      <div className="px-2 py-1.5 text-[10px] text-lt-fg3 text-center">
                        Fleet check-in status icons arrive with warehouse check-in tracking.
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Card ────────────────────────────────────────────────────────

function JobCard({
  job: j,
  column,
  derived,
  today,
  tomorrow,
  moving,
  onMove,
}: {
  job: JobRow
  column: BoardColumn
  derived: BoardColumn
  today: string
  tomorrow: string
  moving: boolean
  onMove: (target: BoardColumn | null) => void
}) {
  const value = j.orderTotal > 0 ? j.orderTotal : j.estimatedValue

  // Band + status pill are column-specific.
  let band: string
  let pillLabel: string
  let pillCls: string
  if (column === 'OUT') {
    const u = outUrgency(j, today, tomorrow)
    band = OUT_BAND[u]
    pillLabel = OUT_LABEL[u]
    pillCls = OUT_PILL[u]
  } else if (column === 'RETURNED') {
    band = 'border-zinc-400'
    pillLabel = j.status === 'WRAPPED' ? 'Wrapped' : 'Returned'
    pillCls = 'bg-zinc-200 text-zinc-700'
  } else {
    const pb = prejobBand(j)
    band = pb.band
    pillLabel = pb.label
    pillCls = pb.pill
  }

  const w = jobWindow(j)
  const overridden = j.boardPhaseOverride != null
  const idx = BOARD_COLUMNS.indexOf(column)
  const leftTarget = idx > 0 ? BOARD_COLUMNS[idx - 1] : null
  const rightTarget = idx < BOARD_COLUMNS.length - 1 ? BOARD_COLUMNS[idx + 1] : null

  const moveBtn = (target: BoardColumn, arrow: string, title: string) => (
    <button
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        // Moving TO the derived column just clears the override.
        onMove(target === derived ? null : target)
      }}
      disabled={moving}
      title={title}
      className="px-1.5 py-0.5 rounded border border-lt-hairline text-lt-fg3 hover:text-lt-fg hover:border-lt-fg2 disabled:opacity-40 text-[11px] leading-none"
    >
      {arrow}
    </button>
  )

  return (
    <Link
      href={`/jobs/${j.id}`}
      className={`block bg-lt-card border border-lt-hairline border-l-4 ${band} rounded-lg px-3 py-2.5 hover:bg-lt-inner transition-colors`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono uppercase tracking-wider text-lt-fg3">{j.jobCode}</span>
        {j.hasDelivery && column !== 'RETURNED' && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500 text-white" title="Delivery — a booking on this job has a delivery address">
            Delivery
          </span>
        )}
        {j.hasLD && (
          <span className="text-chip-bad-fg text-[10px] leading-none" title="Loss & Damage claim open">▲</span>
        )}
        <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${pillCls}`}>
          {pillLabel}
        </span>
      </div>

      <div className="mt-1 text-[13px] font-medium text-lt-fg leading-tight">
        {j.name}
        {j.company?.name && (
          <>
            <span className="text-lt-fg3 font-normal"> · </span>
            <span className="text-lt-fg2 font-normal">{j.company.name}</span>
          </>
        )}
      </div>

      <div className="mt-0.5 text-[10.5px] text-lt-fg2 flex items-center gap-1 flex-wrap leading-snug">
        {j.primaryContact ? (
          <span>{j.primaryContact.firstName} {j.primaryContact.lastName}</span>
        ) : (
          <span className="text-lt-fg3">no contact</span>
        )}
        <span className="text-lt-fg3">·</span>
        <span>{j.agent?.name || '—'}</span>
        {(w.start || w.end) && (
          <>
            <span className="text-lt-fg3">·</span>
            <span className="text-lt-fg3">{fmtDate(w.start)} → {fmtDate(w.end)}</span>
          </>
        )}
      </div>

      {/* Lead-queue hint carried over from the flat list. */}
      {j.status === 'NEW' && (
        <div className="mt-1 text-[10.5px] flex items-center gap-1 flex-wrap leading-snug">
          {j.primaryContact?.email && <span className="text-lt-fg2">{j.primaryContact.email}</span>}
          <span className="text-lt-fg3">·</span>
          <span className="font-semibold text-yellow-700">
            {!j.startDate && !j.bookingWindow?.start ? 'needs dates' : (j._count?.orders ?? 0) === 0 ? 'needs quote' : 'ready to quote'}
          </span>
        </div>
      )}

      {/* RETURNED shows closeout pips; the other columns keep the full
          paperwork/billing chip strip. */}
      {column === 'RETURNED' ? (
        <div className="mt-1.5">
          <CloseoutPips billing={j.billing} />
        </div>
      ) : (
        <div className="mt-1.5">
          <SubRowChips paperwork={j.paperwork} billing={j.billing} hasStageScope={!!j.hasStageScope} />
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[12.5px] font-mono font-medium text-lt-fg">
          {fmtMoney(value)}
          {j.orderTotal === 0 && j.estimatedValue != null && (
            <span className="ml-1 text-[8px] text-lt-fg3 uppercase">est</span>
          )}
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          {overridden && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMove(null) }}
              disabled={moving}
              title="Clear manual placement — card returns to its computed column"
              className="text-[9px] text-lt-fg3 hover:text-lt-fg underline underline-offset-2 disabled:opacity-40"
            >
              manual · reset
            </button>
          )}
          {leftTarget && moveBtn(leftTarget, '‹', `Move to ${COLUMN_META[leftTarget].title}`)}
          {rightTarget && moveBtn(rightTarget, '›', `Move to ${COLUMN_META[rightTarget].title}`)}
        </span>
      </div>
    </Link>
  )
}

// RETURNED closeout pips — invoiced? paid? straight off the billing
// rollup (reconciled Invoice columns only; no payment math here).
function CloseoutPips({ billing }: { billing: BillingRollup | undefined }) {
  const state = billing?.state ?? 'NOT_INVOICED'
  const invoiced = state !== 'NOT_INVOICED' && state !== 'DRAFT'
  const paid = state === 'PAID'
  const pip = (label: string, on: boolean, badWhenOff: boolean) => (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
        on ? 'bg-chip-good-bg text-chip-good-fg' : badWhenOff ? 'bg-chip-warn-bg text-chip-warn-fg' : 'border border-dashed border-chip-muted-border text-chip-muted-fg'
      }`}
    >
      {on ? '✓' : '−'} {label}
    </span>
  )
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {pip('Invoiced', invoiced, true)}
      {pip('Paid', paid, invoiced)}
      {billing && billing.balanceDue > 0 && (
        <span className="text-[10px] text-chip-bad-fg font-semibold">{fmtMoney(billing.balanceDue)} due</span>
      )}
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
