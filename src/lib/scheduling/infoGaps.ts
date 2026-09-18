/**
 * Incomplete call-in reservations — the shared definition of "what's
 * still missing", used by every surface that shows the triangle.
 *
 * Origin (Wes, 2026-08-24): a client phones in a reservation before the
 * production company or the job/show name exist. Blocking the hold on
 * that information loses the booking; the unit has to come off the board
 * NOW. So the hold is created with the pieces that are known and carries
 * its own to-do list until an agent finishes it.
 *
 * Two storage conventions this module hides from callers:
 *   • `Booking.companyId` is NULLable — NULL means "not known yet".
 *   • `Booking.jobName` stays NOT NULL; EMPTY STRING means "not named
 *     yet". (Legacy Planyo rows carry a jobName with no jobId, so a null
 *     jobId alone would light up hundreds of historical bookings.)
 *
 * The ORDER gap is DERIVED since 2026-09-18, not declared. Wes: "of course
 * every vehicle will be attached to an order, because that is how we bill
 * clients" — so asking an agent to tick "an order will be attached" asked
 * them to state the obvious, and the tick read to the desk as the WAREHOUSE
 * order (the gear list), which is a different thing entirely and lives on
 * `Order.warehouseOrderExpected`. A reservation with no order is simply
 * incomplete: 32 live ones were, on the day this changed, and only ONE of
 * them carried the tick.
 *
 * Two guards keep that honest:
 *   • `orderCount` must be KNOWN. A caller that cannot count orders gets
 *     the old declared behaviour rather than a false alarm.
 *   • a reservation that has already ENDED is history, not a to-do. Without
 *     this, scrolling the board back lights up 237 finished Planyo-era
 *     rentals with a triangle nobody can act on.
 *
 * `Booking.expectsOrder` stays in the schema and the info route still
 * toggles it; nothing reads it for the gap any more.
 */

export type BookingInfoGapKey = 'company' | 'job' | 'order'

export interface BookingInfoGap {
  key: BookingInfoGapKey
  /** Short noun for chips/tooltips — "Company", "Job name", "Order". */
  label: string
  /** One line explaining what to do about it. */
  detail: string
}

export interface BookingInfoShape {
  companyId?: string | null
  jobId?: string | null
  jobName?: string | null
  expectsOrder?: boolean | null
  /** Number of non-cancelled Orders attached. Omit when unknown — the
   *  order gap is then reported off `expectsOrder` alone. */
  orderCount?: number | null
  /** When the rental ends. A finished reservation is never asked for an
   *  order it will now never get. Omit and it counts as live. */
  endDate?: Date | string | null
}

const GAP_DEFS: Record<BookingInfoGapKey, Omit<BookingInfoGap, 'key'>> = {
  company: { label: 'Company', detail: 'No production company on this reservation yet.' },
  job: { label: 'Job name', detail: 'No job/show name on this reservation yet.' },
  order: { label: 'Order', detail: 'No order on this reservation yet — the vehicles have nothing to bill against.' },
}

/** True when the booking has no production company. */
export function isCompanyMissing(b: BookingInfoShape): boolean {
  return !b.companyId
}

/** True when the booking has neither a linked Job nor a typed job name. */
export function isJobMissing(b: BookingInfoShape): boolean {
  return !b.jobId && !(b.jobName ?? '').trim()
}

/**
 * Everything still outstanding on a reservation, in the order an agent
 * would fill it in. Empty array = complete (no triangle).
 */
/** Has this rental already finished? Undated reads as live. */
function hasEnded(b: BookingInfoShape, now: Date = new Date()): boolean {
  if (b.endDate == null) return false
  const end = b.endDate instanceof Date ? b.endDate : new Date(b.endDate)
  if (Number.isNaN(end.getTime())) return false
  // Calendar dates are stored at UTC midnight; compare like with like.
  return end.getTime() < new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`).getTime()
}

/** True when this reservation has no order to bill its vehicles on. */
export function isOrderMissing(b: BookingInfoShape): boolean {
  if (b.orderCount == null) return !!b.expectsOrder // unknown → the old declared rule
  return b.orderCount === 0 && !hasEnded(b)
}

export function bookingInfoGaps(b: BookingInfoShape): BookingInfoGap[] {
  const keys: BookingInfoGapKey[] = []
  if (isCompanyMissing(b)) keys.push('company')
  if (isJobMissing(b)) keys.push('job')
  if (isOrderMissing(b)) keys.push('order')
  return keys.map((key) => ({ key, ...GAP_DEFS[key] }))
}

/** Convenience for list payloads / conditional rendering. */
export function hasInfoGaps(b: BookingInfoShape): boolean {
  return bookingInfoGaps(b).length > 0
}

/** "Missing: Company, Job name" — tooltip/aria text. Empty when complete. */
export function infoGapSummary(b: BookingInfoShape): string {
  const gaps = bookingInfoGaps(b)
  if (!gaps.length) return ''
  return `Missing: ${gaps.map((g) => g.label).join(', ')}`
}

/** Display fallbacks so an incomplete booking never renders as blank. */
export const COMPANY_TBD = 'Company TBD'
export const JOB_TBD = 'Job TBD'

export function companyLabel(name: string | null | undefined): string {
  return name?.trim() || COMPANY_TBD
}

export function jobLabel(name: string | null | undefined): string {
  return name?.trim() || JOB_TBD
}
