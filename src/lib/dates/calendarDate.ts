/**
 * Formatting for CALENDAR DATES — the one way to render a date-only value.
 *
 * The bug this exists to stop (found 2026-08-25 on a real submission):
 * Giovanna Trujillo's web-form order asked for 2026-08-26 → 2026-08-28. The
 * notification email said exactly that. HQ's inquiry page said Aug 25 → Aug
 * 27. Nothing was wrong with the data — both dates were stored correctly as
 * UTC midnight. The page called
 *
 *     new Date('2026-08-26T00:00:00Z').toLocaleDateString('en-US', {…})
 *
 * with no timeZone, so it rendered in the operator's zone (UTC-7) and rolled
 * back to the 25th. Every rental window in that surface was a day early.
 *
 * The distinction that matters:
 *
 *   CALENDAR DATE — "the 26th". A pickup, a return, a due date. It means the
 *     same thing in every time zone and must NOT be shifted. Use these
 *     helpers; they pin to UTC because that is how the DB stores them.
 *
 *   INSTANT — "when this was submitted". A timestamp. It genuinely differs by
 *     zone and SHOULD render in the reader's local time. Do NOT use these
 *     helpers; plain toLocaleString is right.
 *
 * If you are formatting something a client picked off a calendar, it belongs
 * here. If you are formatting when something happened, it does not.
 */

/** Accepts a Date, an ISO string, or null/undefined. */
export type CalendarDateInput = Date | string | null | undefined

const FALLBACK = '—'

function toDate(value: CalendarDateInput): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Render a calendar date. Always UTC — see the header.
 *
 * @param opts Intl options MINUS timeZone, which is forced. Defaults to
 *             "Aug 26, 2026".
 */
export function formatCalendarDate(
  value: CalendarDateInput,
  opts: Omit<Intl.DateTimeFormatOptions, 'timeZone'> = { month: 'short', day: 'numeric', year: 'numeric' },
  fallback = FALLBACK,
): string {
  const d = toDate(value)
  if (!d) return fallback
  return d.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
}

/** "Aug 26 – Aug 28, 2026"; one date when start and end match. */
export function formatCalendarRange(
  start: CalendarDateInput,
  end: CalendarDateInput,
  fallback = FALLBACK,
): string {
  const a = toDate(start)
  const b = toDate(end)
  if (!a && !b) return fallback
  if (!a || !b) return formatCalendarDate(a ?? b, undefined, fallback)
  const from = formatCalendarDate(a)
  const to = formatCalendarDate(b)
  if (from === to) return from
  // Drop the repeated year on the left within one year.
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear()
  return sameYear ? `${from.replace(/,\s*\d{4}$/, '')} – ${to}` : `${from} – ${to}`
}

/** The YYYY-MM-DD a date-only value represents, for inputs and API bodies. */
export function toCalendarDateString(value: CalendarDateInput): string {
  const d = toDate(value)
  return d ? d.toISOString().slice(0, 10) : ''
}
