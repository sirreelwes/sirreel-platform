/**
 * A job has no dates of its own.
 *
 * Dates belong to the things that are actually scheduled: an Order has a
 * pickup and a return, an asset rental has its own. `Job.startDate` /
 * `Job.endDate` were a separately-typed third copy, and they drifted —
 * at the time this was written, 2 of the 3 jobs with orders disagreed
 * with them, one showing Jul 23–27 for a job whose orders spanned Jan
 * 2025 to Jul 2026. That number was feeding the RentalWorks order
 * matcher and printing on signed contracts.
 *
 * Where a range genuinely is needed (ranking RW candidates, a rollup for
 * display), derive it from what is scheduled rather than storing a
 * fourth opinion.
 *
 * The columns were DROPPED on 2026-08-31 (Wes: "let the dates only be
 * with the individual orders … I don't think we need it"). Values for
 * all 229 dated jobs are snapshotted in tmp/job-dates-backup-*.json.
 *
 * ── Why bookings count too ─────────────────────────────────────────
 *
 * 223 of those 229 jobs had NO orders at all — they are Planyo-era
 * imports whose only schedule is a Booking. Deriving from orders alone
 * would have blanked the date on every one of them and emptied the Going
 * out / Coming back strip. So the range spans orders AND live bookings;
 * measured before the drop, that left exactly 2 jobs with no date
 * anywhere, and neither had anything scheduled to have a date about.
 *
 * NOTE for per-order documents: a contract or invoice covers ONE order,
 * so it should print THAT order's dates, not the job-wide span. This
 * helper is for job-level rollups only.
 */

export interface OrderDates {
  startDate: Date | string | null
  endDate: Date | string | null
  status?: string | null
}

export interface JobDateRange {
  start: Date | null
  end: Date | null
}

/** Orders that shouldn't drag the range around. */
const IGNORED_STATUSES = new Set(['CANCELLED', 'LOST', 'VOID'])

const toDate = (v: Date | string | null): Date | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Bookings that shouldn't drag the range around either. */
const IGNORED_BOOKING_STATUSES = new Set(['CANCELLED', 'ARCHIVED'])

/**
 * Earliest start → latest end across everything scheduled on the job,
 * ignoring cancelled/lost orders and cancelled/archived bookings.
 *
 * Returns nulls when nothing dated remains, which callers should render
 * as "—" rather than substituting today. A job with no schedule has no
 * dates, and saying so is more useful than inventing one.
 */
export function deriveJobDateRange(
  orders: OrderDates[],
  bookings: OrderDates[] = [],
): JobDateRange {
  const liveOrders = orders.filter((o) => !o.status || !IGNORED_STATUSES.has(o.status))
  const liveBookings = bookings.filter(
    (b) => !b.status || !IGNORED_BOOKING_STATUSES.has(b.status),
  )
  const all = [...liveOrders, ...liveBookings]
  const starts = all.map((o) => toDate(o.startDate)).filter((d): d is Date => d !== null)
  const ends = all.map((o) => toDate(o.endDate)).filter((d): d is Date => d !== null)
  return {
    start: starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null,
    end: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
  }
}

/**
 * The window ONE order actually covers — for a quote, a contract, an
 * invoice: anything that speaks about a single order.
 *
 * Not the job rollup above. This exists because the order HEADER dates are
 * optional and reps routinely leave them blank, while the thing being
 * quoted is pinned to real days anyway:
 *
 *   1. the order's own startDate / endDate, when set — always wins;
 *   2. else the line items, whose pickupDate / returnDate are NOT NULLABLE,
 *      so any order with lines has real dates;
 *   3. else the booking this order hangs off — a vehicle hold with no
 *      lines on it yet still holds specific days;
 *   4. else any live hold on the job.
 *
 * Wes 2026-09-01: "I especially hate when a quote email says dates TBD when
 * actually we have order or vehicle holding for a specific date." Reading
 * only (1) was exactly that bug.
 *
 * The two bounds resolve independently, so an order with a start typed in
 * and no end fills the end from its lines rather than dropping to TBD.
 */
export interface OrderWindowSource {
  startDate: Date | string | null
  endDate: Date | string | null
  lineItems?: { pickupDate: Date | string | null; returnDate: Date | string | null }[] | null
  booking?: OrderDates | null
  job?: { bookings?: OrderDates[] | null } | null
}

export function deriveOrderWindow(order: OrderWindowSource | null | undefined): JobDateRange {
  if (!order) return { start: null, end: null }

  const liveHold = (b: OrderDates | null | undefined): boolean =>
    !!b && (!b.status || !IGNORED_BOOKING_STATUSES.has(b.status))

  const lineStarts = (order.lineItems ?? [])
    .map((l) => toDate(l.pickupDate))
    .filter((d): d is Date => d !== null)
  const lineEnds = (order.lineItems ?? [])
    .map((l) => toDate(l.returnDate))
    .filter((d): d is Date => d !== null)

  const jobHolds = (order.job?.bookings ?? []).filter(liveHold)
  const holds = [
    ...(liveHold(order.booking) ? [order.booking as OrderDates] : []),
    ...jobHolds,
  ]
  const holdStarts = holds.map((b) => toDate(b.startDate)).filter((d): d is Date => d !== null)
  const holdEnds = holds.map((b) => toDate(b.endDate)).filter((d): d is Date => d !== null)

  const earliest = (ds: Date[]): Date | null =>
    ds.length ? new Date(Math.min(...ds.map((d) => d.getTime()))) : null
  const latest = (ds: Date[]): Date | null =>
    ds.length ? new Date(Math.max(...ds.map((d) => d.getTime()))) : null

  return {
    start: toDate(order.startDate) ?? earliest(lineStarts) ?? earliest(holdStarts),
    end: toDate(order.endDate) ?? latest(lineEnds) ?? latest(holdEnds),
  }
}

/** The select both sides of a derived range need. */
export const JOB_DATE_SOURCE_SELECT = {
  orders: { select: { startDate: true, endDate: true, status: true } },
  bookings: { select: { startDate: true, endDate: true, status: true } },
} as const

/** ISO yyyy-MM-dd for a derived bound, or null. Dates are @db.Date, so
 *  slice the UTC calendar date rather than formatting in local time. */
export function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}
