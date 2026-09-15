/**
 * Calendar arithmetic for the owner numbers page, on DAY KEYS.
 *
 * Every figure on that page is "how much landed between these two days", and
 * the two kinds of timestamp it reads disagree about what a day is:
 *
 *   - real instants (Order.createdAt, Payment.receivedAt, observedPaidAt) are
 *     bucketed by the PACIFIC calendar day — the business day everywhere in HQ;
 *   - date-only columns (RwInvoice.invoiceDate is stored as 00:00Z) already ARE
 *     a calendar day. Converting one to Pacific moves every invoice to the day
 *     before, and the first of the month into last month.
 *
 * So both are reduced to a `YYYY-MM-DD` string first and everything after that
 * is string comparison, which has no time zone to get wrong. Pure — no Prisma —
 * so `npm run test:owner-numbers` can pin the edges.
 */

const PACIFIC = 'America/Los_Angeles'

const pacificFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The Pacific calendar day an instant falls on. */
export function pacificDayKey(d: Date): string {
  const parts = pacificFmt.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** The calendar day a date-only column holds (stored as 00:00Z). */
export function dateOnlyKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parse(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00Z`)
}

export function addDays(dayKey: string, n: number): string {
  return new Date(parse(dayKey).getTime() + n * 86_400_000).toISOString().slice(0, 10)
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

/** `YYYY-MM` shifted by n months. */
export function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** Half-open day range: start inclusive, end exclusive. */
export interface DayRange {
  start: string
  end: string
}

export function inRange(dayKey: string, r: DayRange): boolean {
  return dayKey >= r.start && dayKey < r.end
}

export function monthRange(monthKey: string): DayRange {
  return { start: `${monthKey}-01`, end: `${addMonths(monthKey, 1)}-01` }
}

/**
 * Month-to-date, and the same stretch of an earlier month.
 *
 * "September so far" on the 15th is compared with August 1–15, not with all of
 * August — a whole prior month against half of this one reads as a collapse
 * every morning until the 31st. The day is clamped to the shorter month, so
 * March 31 compares with February 28/29, not with a range spilling into March.
 */
export function monthToDate(todayKey: string, monthsBack = 0): DayRange {
  const thisMonth = todayKey.slice(0, 7)
  const day = Number(todayKey.slice(8, 10))
  const month = addMonths(thisMonth, -monthsBack)
  const [y, m] = month.split('-').map(Number)
  const lastDay = Math.min(day, daysInMonth(y, m))
  return { start: `${month}-01`, end: addDays(`${month}-${String(lastDay).padStart(2, '0')}`, 1) }
}

/** The Monday (ISO week start) of the week a day falls in. */
export function weekKey(dayKey: string): string {
  const dow = parse(dayKey).getUTCDay() // 0 = Sunday
  return addDays(dayKey, -((dow + 6) % 7))
}

/** The last n week keys, oldest first, ending with the current week. */
export function lastWeeks(todayKey: string, n: number): string[] {
  const current = weekKey(todayKey)
  return Array.from({ length: n }, (_, i) => addDays(current, -7 * (n - 1 - i)))
}

/** The last n month keys, oldest first, ending with the current month. */
export function lastMonths(todayKey: string, n: number): string[] {
  const current = todayKey.slice(0, 7)
  return Array.from({ length: n }, (_, i) => addMonths(current, -(n - 1 - i)))
}

/** Whole days from one day key to another. */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((parse(toKey).getTime() - parse(fromKey).getTime()) / 86_400_000)
}
