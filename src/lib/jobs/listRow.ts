/**
 * Jobs list row — the shape and the one derived answer to "what state
 * is this job in", shared by the /jobs sidebar list and the /jobs
 * overview panel.
 *
 * WHY IT LIVES HERE. The list is now split across two component trees
 * (a persistent sidebar in the jobs layout, and whatever renders in
 * the right panel), so the derivation can't sit in a page file any
 * more. It is the same derivation the old three-column board used —
 * only the presentation changed: cycle position is COLOR now, not a
 * column.
 *
 *   0. Job.returnedAt != null → BACK. ONLY that — physical return is
 *      semantic state set via mark-returned (the manual v1 of the
 *      future warehouse check-in flow). A passed end date proves
 *      nothing came back.
 *   1. Manual override (sr_job_board_overrides, PREJOB↔OUT) still
 *      honored — the interim stand-in until checkout events exist.
 *   2. Order-driven cadence (server rollup) when the job has live
 *      orders. returned/invoiced/wrapped WITHOUT returnedAt read as
 *      OVERDUE: nobody confirmed the gear came back.
 *   3. Date fallback (jobs with no orders — Planyo imports):
 *      Job.startDate/endDate, else the booking envelope from the API.
 *   HOLD/LOST are human off-ramps and always read as such.
 */

export const JOB_STATUSES = ['NEW', 'QUOTED', 'ACTIVE', 'WRAPPED', 'HOLD', 'LOST'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

// Phase 7 — paperwork rollup shape returned by /api/jobs. See
// rollupAgreementState / rollupCoiState in the route for state derivation.
export type AgreementRollupState = 'NONE' | 'DRAFT' | 'SENT' | 'PARTIAL' | 'SIGNED'
export type CoiRollupState = 'NONE' | 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'ISSUE'
// Phase 7 — billing rollup. Derived from the reconciled Invoice columns
// only (status / balanceDue / total / dueDate). PENDING/SETTLED ACH
// never bleeds into "paid" because reconcileInvoiceTotals counts
// CLEARED-only when it writes amountPaid + balanceDue.
export type BillingRollupState =
  | 'NOT_INVOICED'
  | 'DRAFT'
  | 'SENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'

export interface PaperworkRollup {
  rental: { state: AgreementRollupState; count: number }
  stage: { state: AgreementRollupState; count: number } | null
  coi: { state: CoiRollupState; expiresAt?: string | null }
}

export interface BillingRollup {
  state: BillingRollupState
  balanceDue: number
}

export interface JobRow {
  id: string
  jobCode: string
  assistantAuthCode: string | null
  name: string
  status: JobStatus
  startDate: string | null
  createdAt: string
  endDate: string | null
  orderTotal: number
  rwInvoicedTotal: number
  rwOrderCount: number
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
  cadence?: { state: string; partial: boolean }
  hasLD?: boolean
  hasStageScope?: boolean
  blindPickup?: boolean
  blindReturn?: boolean
  _count?: { orders: number }
  // bookingWindow = min/max across the job's bookings; hasDelivery =
  // any booking with a delivery address.
  bookingWindow?: { start: string | null; end: string | null } | null
  hasDelivery?: boolean
  // Legacy PREJOB/OUT presentation override from the retired board.
  // Still honored — it decides which side of the cadence a row reads
  // from — and resettable from the row.
  boardPhaseOverride?: 'PREJOB' | 'OUT' | null
  // Physical return — semantic, set via mark-returned.
  returnedAt?: string | null
  returnedBy?: { id: string; name: string } | null
}

// ─── The color coding ────────────────────────────────────────────

export type RowState =
  | 'overdue'
  | 'returning-today'
  | 'picking-today'
  | 'returning-tmw'
  | 'picking-tmw'
  | 'on-rental'
  | 'booked'
  | 'new'
  | 'quoted'
  | 'hold'
  | 'back'
  | 'lost'

export interface StateMeta {
  label: string
  short: string
  /** Saturated left rail — reads on any surface; this is the color code. */
  rail: string
  /** Pill text hue. */
  fg: string
  /** Pill background tint, for a pill sitting on a plain surface. A
   *  pill on the selected (amber) row drops the tint for white instead,
   *  keeping the hue in the text where it stays legible. */
  tint: string
}

// Temperature scheme, same idea as the `cadence.*` tokens: blue =
// future/outbound → green = out with the client → amber/orange =
// coming back → purple = back. The states nobody works today (Hold /
// Lost) go grey so a parked job never competes with a truck that's
// due. `overdue` is deliberately the loudest thing in the list — it
// is the one state that carries a solid fill rather than a tint.
//
// Static class strings so Tailwind's content scanner sees them.
export const STATE: Record<RowState, StateMeta> = {
  overdue:           { label: 'Not returned',        short: 'Not back',   rail: 'bg-red-500',     fg: 'text-white',        tint: 'bg-red-600'      },
  'returning-today': { label: 'Returning today',     short: 'Back today', rail: 'bg-orange-500',  fg: 'text-orange-800',   tint: 'bg-orange-100'   },
  'picking-today':   { label: 'Picking up today',    short: 'Out today',  rail: 'bg-indigo-500',  fg: 'text-indigo-800',   tint: 'bg-indigo-100'   },
  'returning-tmw':   { label: 'Returning tomorrow',  short: 'Back tmw',   rail: 'bg-amber-500',   fg: 'text-amber-800',    tint: 'bg-amber-100'    },
  'picking-tmw':     { label: 'Picking up tomorrow', short: 'Out tmw',    rail: 'bg-blue-500',    fg: 'text-blue-800',     tint: 'bg-blue-100'     },
  'on-rental':       { label: 'On rental',           short: 'On rental',  rail: 'bg-emerald-500', fg: 'text-emerald-800',  tint: 'bg-emerald-100'  },
  booked:            { label: 'Booked',              short: 'Booked',     rail: 'bg-sky-600',     fg: 'text-sky-800',      tint: 'bg-sky-100'      },
  new:               { label: 'New',                 short: 'New',        rail: 'bg-yellow-400',  fg: 'text-yellow-800',   tint: 'bg-yellow-100'   },
  quoted:            { label: 'Quoted',              short: 'Quoted',     rail: 'bg-violet-500',  fg: 'text-violet-800',   tint: 'bg-violet-100'   },
  hold:              { label: 'Hold',                short: 'Hold',       rail: 'bg-stone-500',   fg: 'text-stone-700',    tint: 'bg-stone-200'    },
  back:              { label: 'Returned',            short: 'Returned',   rail: 'bg-purple-500',  fg: 'text-purple-800',   tint: 'bg-purple-100'   },
  lost:              { label: 'Lost',                short: 'Lost',       rail: 'bg-zinc-400',    fg: 'text-zinc-500',     tint: 'bg-zinc-100'     },
}

// Default sort: the list reads top-down as "what needs a human today"
// → "what's running" → "what's sold" → "what's done". Index IS rank.
export const URGENCY: RowState[] = [
  'overdue',
  'returning-today',
  'picking-today',
  'returning-tmw',
  'picking-tmw',
  'on-rental',
  'booked',
  'new',
  'quoted',
  'hold',
  'back',
  'lost',
]

/** Effective window: the Job's own dates, else the booking envelope. */
export function jobWindow(j: JobRow): { start: string | null; end: string | null } {
  return {
    start: j.startDate?.slice(0, 10) ?? j.bookingWindow?.start ?? null,
    end: j.endDate?.slice(0, 10) ?? j.bookingWindow?.end ?? null,
  }
}

/**
 * Is this job's gear out (or overdue back), as opposed to still ahead
 * of pickup? The same test the retired board used for its columns.
 */
function isOut(j: JobRow, today: string): boolean {
  if (j.status === 'HOLD' || j.status === 'LOST') return false
  const c = j.cadence?.state
  if (c === 'new' || c === 'quoted') return false
  if (c === 'on-rental' || c === 'returning-tmw' || c === 'returning-today') return true
  // Orders say returned/invoiced (or the job is WRAPPED) but nobody
  // confirmed the physical return — still out, and overdue.
  if (c === 'returned' || c === 'invoiced' || c === 'wrapped') return true
  if (c === 'picking-tmw' || c === 'picking-today') return false
  // cadence 'booked' with real orders = genuinely future.
  if ((j._count?.orders ?? 0) > 0) return false
  // No orders (Planyo imports) → decide by dates. No dates → not out.
  const w = jobWindow(j)
  if (!w.start || !w.end) return false
  return w.start <= today
}

/** The one display state per row — this is what drives the color. */
export function rowState(j: JobRow, today: string, tomorrow: string): RowState {
  if (j.returnedAt) return 'back'
  const out = j.boardPhaseOverride ? j.boardPhaseOverride === 'OUT' : isOut(j, today)

  if (out) {
    const c = j.cadence?.state
    if (c === 'returning-today') return 'returning-today'
    if (c === 'returning-tmw') return 'returning-tmw'
    if (c === 'on-rental') return 'on-rental'
    if (c === 'returned' || c === 'invoiced' || c === 'wrapped') return 'overdue'
    const end = jobWindow(j).end
    if (!end) return 'on-rental'
    if (end < today) return 'overdue'
    if (end === today) return 'returning-today'
    if (end === tomorrow) return 'returning-tmw'
    return 'on-rental'
  }

  switch (j.cadence?.state) {
    case 'new':    return 'new'
    case 'quoted': return 'quoted'
    case 'hold':   return 'hold'
    case 'lost':   return 'lost'
    case 'picking-today': return 'picking-today'
    case 'picking-tmw':   return 'picking-tmw'
    default:       return 'booked'
  }
}

/** Label with the partial-return modifier the cadence rollup flags. */
export function stateLabel(j: JobRow, s: RowState, short = false): string {
  if (j.cadence?.partial) {
    if (s === 'returning-today') return short ? 'Partial · today' : 'Partial return · today'
    if (s === 'returning-tmw') return short ? 'Partial · tmw' : 'Partial return · tomorrow'
    if (s === 'back') return 'Partial return'
  }
  return short ? STATE[s].short : STATE[s].label
}

/**
 * The date a row is read and sorted by: the next thing to happen.
 * Out → the return date; everything else → the pickup date.
 */
export function keyDate(j: JobRow, s: RowState): string | null {
  const w = jobWindow(j)
  const outish = s === 'on-rental' || s === 'returning-today' || s === 'returning-tmw' || s === 'overdue'
  return (outish ? w.end : w.start) ?? w.start ?? w.end
}

/** Value shown on a row: booked total → RW invoiced → the estimate. */
export function rowValue(j: JobRow): number | null {
  if (j.orderTotal > 0) return j.orderTotal
  if (j.rwInvoicedTotal > 0) return j.rwInvoicedTotal
  return j.estimatedValue
}

// ─── Formatting ──────────────────────────────────────────────────

export function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Returned receipt — a real timestamp (mark-returned), so show the time. */
export function fmtDateTime(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function fmtMoney(n: number | null | undefined) {
  if (n == null || n === 0) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/** today + tomorrow the way the API's cadence rollup computes them. */
export function listDays(): { today: string; tomorrow: string } {
  const t = new Date()
  t.setUTCHours(0, 0, 0, 0)
  const tm = new Date(t)
  tm.setUTCDate(tm.getUTCDate() + 1)
  return { today: t.toISOString().slice(0, 10), tomorrow: tm.toISOString().slice(0, 10) }
}
