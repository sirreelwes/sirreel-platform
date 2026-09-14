/**
 * Yard / lot access hours — the one prisma-free place they live.
 *
 * Lifted out of src/lib/afterHours/instructions.ts on 2026-09-03. The
 * values were already canonical there (they replaced the frozen
 * "Afer Hours EQ P:R.pdf" flyer), but that module imports `@/lib/prisma`
 * at the top level to read the gate codes out of SiteSetting — and
 * `@/lib/prisma` CONSTRUCTS a PrismaClient at import time. Any client
 * component or PDF-side module that wanted the hours would have dragged
 * a Prisma client into its bundle with them.
 *
 * The booking-details block on the quote PDF and the client portal wants
 * exactly these hours and nothing else from that module, so the hours
 * move here and `instructions.ts` re-exports them. One definition, and a
 * change to the lot's hours still lands everywhere at once.
 *
 * ── Saturday is 7:00 AM – 3:30 PM. The flyer's 7:30 was wrong ─────────
 * Wes confirmed the official Saturday hours on 2026-09-03: 7:00 AM to
 * 3:30 PM. The flyer these values were lifted from said 7:30 AM, so every
 * after-hours surface that inherited it had been opening the lot on paper
 * half an hour after it opens in fact — a Saturday driver told 7:30 waits
 * thirty minutes for a gate that is already open, and one told 7:00 when the
 * truth was 7:30 would sit at a locked one. Same class of bug as the frozen
 * gate code the flyer was retired for; it just happened to live in a field
 * nobody thought to re-check.
 *
 * 7:30 is still correct in ONE place and it is not this one:
 * AFTER_HOURS_SUPPORT.staffedHours is when a human answers the phone
 * (7:30 AM – 5:30 PM). The gate opening and the phone being answered are
 * independent facts about different things — do not "reconcile" them.
 */

/** Yard hours. Weekdays as printed on the flyer these replaced; Saturday per
 *  Wes's 2026-09-03 confirmation, which corrected it. */
export const YARD_HOURS = {
  weekdays: '6:00 AM – 6:00 PM, Monday through Friday',
  saturday: '7:00 AM – 3:30 PM, Saturday',
  sunday: 'Closed Sunday',
} as const

/** The same three facts on one line, for a dense block like a quote PDF. */
export const YARD_HOURS_ONE_LINE =
  'Mon–Fri 6:00 AM – 6:00 PM · Sat 7:00 AM – 3:30 PM · Closed Sunday'

/* ── Which days the yard is dark, as a fact code can ask about ─────────
 *
 * YARD_HOURS.sunday has said "Closed Sunday" since these values were
 * lifted off the flyer, but only in prose — nothing could branch on it.
 * Wes 2026-09-13: "We are closed on sundays, so all pickups and returns
 * on that day should be asked: Is this a blind pickup/dropoff?" A handoff
 * booked for a closed day happens with nobody at the gate, so the desk
 * has to decide which one it is at the moment the date is picked, not
 * discover it when the client is standing there.
 *
 * One list, so a second dark day (a holiday) lands on every surface at
 * once instead of being re-derived per form. */

/** Closed days as `Date#getUTCDay` numbers. Sunday (0) today. */
export const CLOSED_WEEKDAYS: readonly number[] = [0]

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const

/** A calendar day as `YYYY-MM-DD`, or null when there isn't one.
 *
 *  Accepts what the two kinds of caller actually hold: the string an
 *  `<input type="date">` carries, or a `@db.Date` value — which is
 *  midnight UTC, so it is read in UTC. Reading it in Pacific renders the
 *  day BEFORE (see `deriveOrderWindow`), which would make a Sunday pickup
 *  answer as Saturday and skip the question entirely. */
export function calendarDayOf(value: string | Date | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }
  const ymd = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null
}

/** The weekday of a calendar day (0 = Sunday), read in UTC. */
export function weekdayOfCalendarDay(value: string | Date | null | undefined): number | null {
  const ymd = calendarDayOf(value)
  if (!ymd) return null
  const d = new Date(`${ymd}T00:00:00.000Z`)
  return Number.isFinite(d.getTime()) ? d.getUTCDay() : null
}

/** True when the yard is closed that day — nobody at the gate, so a
 *  pickup or a return on it is blind unless someone opens up for it. */
export function isClosedDay(value: string | Date | null | undefined): boolean {
  const wd = weekdayOfCalendarDay(value)
  return wd != null && CLOSED_WEEKDAYS.includes(wd)
}

/** "Sunday, September 20" — the day named back to whoever is being asked
 *  about it. UTC, for the reason above. */
export function calendarDayLabel(value: string | Date | null | undefined): string | null {
  const ymd = calendarDayOf(value)
  if (!ymd) return null
  const d = new Date(`${ymd}T00:00:00.000Z`)
  if (!Number.isFinite(d.getTime())) return null
  return `${WEEKDAY_NAMES[d.getUTCDay()]}, ${d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })}`
}
