/**
 * Job operational cadence — the ONE derived answer to "where is this job
 * right now?", shared by the /jobs board, the /jobs/[id] detail header,
 * and anything else that needs to state a job's position in the cycle.
 *
 * WHY DERIVED. `Job.status` is hand-set: nothing in the app has ever
 * written ACTIVE, WRAPPED, or HOLD — only NEW (create), NEW→QUOTED
 * (portal welcome), and LOST (mark-lost) happen on their own. A pill
 * that only moves when somebody remembers to move it drifts from the
 * orders immediately, which is exactly what it did. So the operational
 * position comes from the orders, and `Job.status` is demoted to what
 * it honestly is: three commercial OFF-RAMPS a human decides.
 *
 *   HOLD  — client paused it. Overrides the orders.
 *   LOST  — didn't win it. Overrides the orders.
 *   WRAPPED — closed early / by hand. Overrides the orders.
 *
 * Everything else (NEW / QUOTED / ACTIVE) yields to the orders: a job
 * with gear out reads "On rental" whether or not anyone flipped it to
 * ACTIVE, and a job whose orders are still DRAFT/QUOTE_SENT reads
 * "Quoted" — no phantom promotion.
 */
import type { JobStatus, OrderStatus } from '@prisma/client'

export type CadenceState =
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

export interface CadenceRollup {
  state: CadenceState
  partial: boolean
}

export const CADENCE_LABEL: Record<CadenceState, string> = {
  new:              'New',
  quoted:           'Quoted',
  hold:             'Hold',
  lost:             'Lost',
  booked:           'Booked',
  'picking-tmw':    'Picking up tomorrow',
  'picking-today':  'Picking up today',
  'on-rental':      'On rental',
  'returning-tmw':  'Returning tomorrow',
  'returning-today':'Returning today',
  returned:         'Returned',
  invoiced:         'Invoiced',
  wrapped:          'Wrapped',
}

// Precedence per spec: most-urgent at the top. Indexes drive the sort.
const CADENCE_RANK: CadenceState[] = [
  'returning-today',
  'picking-today',
  'returning-tmw',
  'picking-tmw',
  'on-rental',
  'booked',
  'returned',
  'invoiced',
  'wrapped',
]

// Orders that count as "still out" for partial-return detection: their
// return hasn't happened yet, so the job isn't fully back.
const STILL_OUT_EVENTS: CadenceState[] = [
  'picking-today',
  'picking-tmw',
  'on-rental',
  'booked',
]

// The three human decisions. Only these override the orders.
const OFF_RAMP: Partial<Record<JobStatus, CadenceState>> = {
  HOLD: 'hold',
  LOST: 'lost',
  WRAPPED: 'wrapped',
}

export function isOffRamp(status: JobStatus): boolean {
  return status in OFF_RAMP
}

export function cadenceForOrder(
  o: { status: OrderStatus; startDate: Date | null; endDate: Date | null },
  today: string,
  tomorrow: string,
): CadenceState | null {
  if (o.status === 'CANCELLED' || o.status === 'DRAFT' || o.status === 'QUOTE_SENT') {
    return null
  }
  const start = o.startDate ? o.startDate.toISOString().slice(0, 10) : null
  const end = o.endDate ? o.endDate.toISOString().slice(0, 10) : null

  if (o.status === 'CLOSED') return 'wrapped'
  if (o.status === 'INVOICED' || o.status === 'LD_CHECK') return 'invoiced'
  if (o.status === 'RETURNED') return 'returned'

  // Out / awaiting pickup. ON_JOB clearly out; LOADED_READY is the day
  // before pickup OR pickup-day-not-yet-checked-out (treated as still
  // outbound until the dates say otherwise).
  if (o.status === 'ON_JOB' || o.status === 'LOADED_READY') {
    if (end && end === today) return 'returning-today'
    if (end && end === tomorrow) return 'returning-tmw'
    if (start && end && start <= today && today <= end) return 'on-rental'
    if (start && start === today) return 'picking-today'
    if (start && start === tomorrow) return 'picking-tmw'
    return 'booked'
  }
  if (o.status === 'APPROVED' || o.status === 'BOOKED') {
    if (start && start === today) return 'picking-today'
    if (start && start === tomorrow) return 'picking-tmw'
    return 'booked'
  }
  return null
}

/**
 * Roll a job's live (non-cancelled) orders up to one operational state.
 *
 * Order of resolution:
 *   1. HOLD / LOST / WRAPPED — the human off-ramps win outright.
 *   2. The orders — every one maps to a cadence event, most-urgent wins.
 *      A return event with other orders still out is flagged `partial`.
 *   3. No orders worth reading (all DRAFT / QUOTE_SENT, or none at all)
 *      — fall back to the commercial state. A legacy hand-set ACTIVE
 *      with nothing live still reads 'booked' so Planyo-era imports and
 *      mid-cycle jobs don't regress to "Quoted".
 */
export function rollupCadence(
  jobStatus: JobStatus,
  liveOrders: { status: OrderStatus; startDate: Date | null; endDate: Date | null }[],
  today: string,
  tomorrow: string,
): CadenceRollup {
  const offRamp = OFF_RAMP[jobStatus]
  if (offRamp) return { state: offRamp, partial: false }

  const events = liveOrders
    .map((o) => cadenceForOrder(o, today, tomorrow))
    .filter((e): e is CadenceState => e !== null)

  if (events.length === 0) {
    if (jobStatus === 'NEW') return { state: 'new', partial: false }
    if (jobStatus === 'QUOTED') return { state: 'quoted', partial: false }
    return { state: 'booked', partial: false }
  }

  events.sort((a, b) => CADENCE_RANK.indexOf(a) - CADENCE_RANK.indexOf(b))
  const top = events[0]

  const isReturnEvent = top === 'returning-today' || top === 'returning-tmw' || top === 'returned'
  const partial = isReturnEvent && events.some((e) => STILL_OUT_EVENTS.includes(e))

  return { state: top, partial }
}

/** Today + tomorrow as YYYY-MM-DD, the form the cadence math compares. */
export function cadenceDays(now = new Date()): { today: string; tomorrow: string } {
  const todayDate = new Date(now)
  todayDate.setUTCHours(0, 0, 0, 0)
  const tomorrowDate = new Date(todayDate)
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1)
  return {
    today: todayDate.toISOString().slice(0, 10),
    tomorrow: tomorrowDate.toISOString().slice(0, 10),
  }
}

/**
 * Cadence state → label, with the partial-return modifier applied when
 * the rollup flagged it. Partial replaces only the inbound return
 * labels — pickup/on-rental events are never partial.
 */
export function formatCadenceLabel(state: CadenceState, partial: boolean): string {
  if (!partial) return CADENCE_LABEL[state]
  if (state === 'returning-today') return 'Partial return · today'
  if (state === 'returning-tmw')   return 'Partial return · tomorrow'
  if (state === 'returned')        return 'Partial returned'
  return CADENCE_LABEL[state]
}
