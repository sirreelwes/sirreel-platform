/**
 * Incomplete call-in reservations — the shared definition of "what's
 * still missing", used by every surface that shows the ⚠ triangle.
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
 * `expectsOrder` is a DECLARED expectation, not a derived fact: the agent
 * ticked "an Order will be attached" at intake. It stays on the list until
 * an Order actually links to the booking (or the agent unticks it), which
 * is exactly the follow-up they asked for.
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
}

const GAP_DEFS: Record<BookingInfoGapKey, Omit<BookingInfoGap, 'key'>> = {
  company: { label: 'Company', detail: 'No production company on this reservation yet.' },
  job: { label: 'Job name', detail: 'No job/show name on this reservation yet.' },
  order: { label: 'Order', detail: 'An order is expected but none is attached yet.' },
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
export function bookingInfoGaps(b: BookingInfoShape): BookingInfoGap[] {
  const keys: BookingInfoGapKey[] = []
  if (isCompanyMissing(b)) keys.push('company')
  if (isJobMissing(b)) keys.push('job')
  if (b.expectsOrder && !(b.orderCount ?? 0)) keys.push('order')
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
