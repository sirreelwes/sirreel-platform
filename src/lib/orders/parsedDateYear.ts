/**
 * Repair a parsed rental date whose YEAR is impossible.
 *
 * Wes, 2026-09-01, after the third one in two days: "trace where the
 * wrong year comes from."
 *
 * It comes from the quote parser's prompt, which asks the model for
 * "YYYY-MM-DD" and never tells it what year it is. A client writing
 * "Sept 4" or "9/17" gives no year, so the model supplies one from its
 * own prior — and it lands wherever its training data sits:
 *
 *   S260831-005  JUST PONDS      2024-09-17   (714 days "overdue")
 *   S260831-009  Hulu Chad Powers 2025-09-04  (362 days)
 *
 * Both were created in HQ days apart, both quoted to the client with a
 * date in the past, and both surfaced as bogus "Not returned" rows.
 *
 * The prompt now states today's date (see parse-quote). This is the
 * second line of defence, because a prompt is a request and not a
 * guarantee: whatever the model returns, a rental date that is most of a
 * year in the past is a wrong year, not a booking.
 *
 * ── Why 180 days and not "any past date" ───────────────────────────
 *
 * Quotes ARE legitimately entered after the fact — a rental that started
 * last week, written up on Monday. Rolling every past date forward would
 * corrupt those. A full year of error is unambiguous; a fortnight is
 * ordinary business. 180 days sits in the gap with room on both sides.
 */

/** Days in the past beyond which a date can only be a wrong year. */
export const IMPOSSIBLE_PAST_DAYS = 180

const DAY = 86_400_000

/** Same month/day, `n` years on. Works on the YYYY-MM-DD text. */
function addYears(day: string, n: number): string {
  return `${Number(day.slice(0, 4)) + n}${day.slice(4)}`
}

/**
 * Roll a parsed date forward whole years until it is no longer absurdly
 * past. Returns the input unchanged when it is already plausible, and
 * null in/null out so callers can pass optional fields straight through.
 *
 * `today` is a YYYY-MM-DD string so the caller decides the timezone —
 * these are @db.Date values and must not be re-interpreted locally.
 */
export function correctImpossibleYear(
  day: string | null | undefined,
  today: string,
): string | null {
  if (!day) return null
  const d = String(day).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const floor = Date.parse(`${today}T00:00:00Z`) - IMPOSSIBLE_PAST_DAYS * DAY
  let out = d
  // Bounded: 20 iterations covers any year a model could plausibly emit,
  // and cannot spin if the input is nonsense.
  for (let i = 0; i < 20 && Date.parse(`${out}T00:00:00Z`) < floor; i++) {
    out = addYears(out, 1)
  }
  return out
}

/** True when correctImpossibleYear would change this date. */
export function hasImpossibleYear(day: string | null | undefined, today: string): boolean {
  if (!day) return false
  const corrected = correctImpossibleYear(day, today)
  return !!corrected && corrected !== String(day).slice(0, 10)
}
