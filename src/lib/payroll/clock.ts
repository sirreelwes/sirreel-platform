/**
 * Clock times ⇄ instants, in Pacific.
 *
 * The paper timesheet says "8:00" and "17:30". The DB stores instants, so
 * that the night shoots that end at 2am can be a real 12-hour span instead of
 * a wrap-around guess (see the TimeEntry comment in schema.prisma). This file
 * is the only place the two representations meet.
 *
 * Pacific, not UTC and not the server's zone. SirReel's crew works in Los
 * Angeles; a shift is 8am *there*. Vercel's lambdas run in UTC, so reading a
 * punch with local getters would render every morning call time as an
 * afternoon one. Neither `new Date('...T08:00')` nor `getHours()` appears
 * anywhere in the payroll code for that reason.
 *
 * DST is handled by asking Intl for the real offset on the day in question
 * rather than assuming −8 or −7. The spring-forward Sunday has no 2:00–3:00
 * am; the fall-back Sunday has two 1:30 ams. Neither is a shift SirReel runs,
 * but a silently-wrong hour twice a year is exactly the kind of payroll bug
 * that gets found in December.
 */

export const PAYROLL_TZ = 'America/Los_Angeles'

/** Offset in ms that must be ADDED to a UTC instant to read Pacific wall time. */
function tzOffsetMs(instant: Date, tz: string = PAYROLL_TZ): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)

  const g: Record<string, string> = {}
  for (const p of parts) g[p.type] = p.value
  const asIfUtc = Date.UTC(
    Number(g.year), Number(g.month) - 1, Number(g.day),
    Number(g.hour) % 24, Number(g.minute), Number(g.second),
  )
  return asIfUtc - instant.getTime()
}

/** "8:00", "08:00", "17:30" → minutes after midnight. null when unparseable. */
export function parseClock(raw: string | null | undefined): number | null {
  if (!raw) return null
  const m = /^\s*(\d{1,2}):?(\d{2})\s*$/.exec(raw)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh > 23 || mm > 59) return null
  return hh * 60 + mm
}

/**
 * A Pacific wall-clock time on a calendar date → the instant it names.
 *
 * `date` is a @db.Date value (UTC midnight); its Y/M/D are read with UTC
 * getters, which is the whole contract of a calendar date.
 */
export function clockToInstant(date: Date, minutesAfterMidnight: number): Date {
  const y = date.getUTCFullYear()
  const mo = date.getUTCMonth()
  const d = date.getUTCDate()
  const naive = Date.UTC(y, mo, d, 0, 0, 0) + minutesAfterMidnight * 60_000

  // Two passes: the first guess uses the offset at the naive instant, which
  // can be the wrong side of a DST boundary; re-reading the offset at the
  // corrected instant settles it.
  let instant = new Date(naive - tzOffsetMs(new Date(naive)))
  instant = new Date(naive - tzOffsetMs(instant))
  return instant
}

/** An instant → "17:30" in Pacific. The inverse of clockToInstant. */
export function instantToClock(instant: Date | null | undefined): string | null {
  if (!instant) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PAYROLL_TZ, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant)
  const g: Record<string, string> = {}
  for (const p of parts) g[p.type] = p.value
  return `${String(Number(g.hour) % 24).padStart(2, '0')}:${g.minute}`
}

/**
 * Build the in/out instants for one day from what the admin typed.
 *
 * The overnight rule: an out that is at or before the in means the shift ran
 * past midnight, so the out lands on the next calendar day. That is how the
 * paper sheet reads — "in 14:00, out 02:00" on one row is a night shoot, not
 * a data-entry error — and it is the only interpretation that yields a
 * sensible span. `date` stays the day the shift started.
 */
export function punchesFor(
  date: Date,
  inClock: string | null | undefined,
  outClock: string | null | undefined,
): { inAt: Date | null; outAt: Date | null } {
  const inMin = parseClock(inClock)
  const outMin = parseClock(outClock)

  const inAt = inMin === null ? null : clockToInstant(date, inMin)
  if (outMin === null) return { inAt, outAt: null }

  let outAt = clockToInstant(date, outMin)
  if (inAt && outAt.getTime() <= inAt.getTime()) {
    const next = new Date(date)
    next.setUTCDate(next.getUTCDate() + 1)
    outAt = clockToInstant(next, outMin)
  }
  return { inAt, outAt }
}
