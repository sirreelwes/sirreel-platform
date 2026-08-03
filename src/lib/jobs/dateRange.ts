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
 * display), derive it from the orders rather than storing a fourth
 * opinion. The columns stay in the database per the additive-only rule —
 * they are simply no longer read or written.
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

/**
 * Earliest order start → latest order end, ignoring cancelled/lost
 * orders. Returns nulls when nothing dated remains, which callers should
 * render as "—" rather than substituting today.
 */
export function deriveJobDateRange(orders: OrderDates[]): JobDateRange {
  const live = orders.filter((o) => !o.status || !IGNORED_STATUSES.has(o.status))
  const starts = live.map((o) => toDate(o.startDate)).filter((d): d is Date => d !== null)
  const ends = live.map((o) => toDate(o.endDate)).filter((d): d is Date => d !== null)
  return {
    start: starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null,
    end: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
  }
}

/** ISO yyyy-MM-dd for a derived bound, or null. Dates are @db.Date, so
 *  slice the UTC calendar date rather than formatting in local time. */
export function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}
