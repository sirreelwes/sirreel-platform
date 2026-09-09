/**
 * Period windows for the Clients-page growth strip ("how many new
 * contacts did we add this week / month / year").
 *
 * Two things this file exists to get right:
 *
 * 1. **Pacific boundaries, as real instants.** "This week" has to mean
 *    Monday 00:00 in Los Angeles, not Monday 00:00 UTC — otherwise a
 *    contact captured Sunday at 5pm PT counts toward the week that has
 *    not started yet, and Monday-morning numbers are wrong for eight
 *    hours every week. `src/lib/orders/weekStart.ts` returns a
 *    UTC-midnight *calendar* date (fine for keying a weekly row, not
 *    for comparing timestamps), so counting needs its own boundary
 *    math. The offset is read from the zone at the boundary itself, so
 *    the DST weekends land right.
 *
 * 2. **An honest comparison.** A partial week compared against a whole
 *    previous week always looks like a collapse. Each window carries a
 *    prior window of the SAME ELAPSED LENGTH, starting at the previous
 *    period's boundary — "the same number of days into last month" —
 *    and the UI labels it that way.
 */

const PACIFIC_TZ = 'America/Los_Angeles'

export type GrowthPeriodKey = 'week' | 'month' | 'year'

export interface GrowthWindow {
  key: GrowthPeriodKey
  /** Card title, e.g. "This week". */
  label: string
  /** How the prior window reads in copy, e.g. "last week to date". */
  priorLabel: string
  /** Inclusive start of the current window (Pacific boundary). */
  start: Date
  /** Exclusive end of the current window — always `now`. */
  end: Date
  /** Inclusive start of the prior window (previous period's boundary). */
  priorStart: Date
  /** Exclusive end of the prior window: priorStart + (end - start). */
  priorEnd: Date
}

/** Y/M/D as they read in Pacific for a given instant. */
function pacificYmd(instant: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(instant)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  // Monday-indexed, matching weekStartPacific.
  const WEEKDAY_OFFSET: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  }
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_OFFSET[get('weekday')] ?? 0,
  }
}

/** Milliseconds Pacific is ahead of UTC at `instant` (negative here). */
function pacificOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  // Intl renders midnight as hour 24 under hour12:false in some engines.
  const hour = get('hour') % 24
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
  return asUtc - instant.getTime()
}

/**
 * The instant at which the given Pacific calendar day begins.
 *
 * Resolved in two passes: guess with the offset in effect at UTC
 * midnight, then re-read the offset at the guess. That second pass is
 * what keeps the two DST weekends correct — on the March forward the
 * first guess lands an hour before the day starts.
 */
export function pacificDayStart(year: number, month: number, day: number): Date {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0)
  let instant = new Date(naive - pacificOffsetMs(new Date(naive)))
  instant = new Date(naive - pacificOffsetMs(instant))
  return instant
}

/** Midnight Pacific starting the Monday of `now`'s week. */
export function pacificWeekStart(now: Date): Date {
  const { year, month, day, weekday } = pacificYmd(now)
  // Date.UTC normalises a negative day-of-month back across the month
  // boundary, so no separate "went past the 1st" branch is needed.
  const shifted = new Date(Date.UTC(year, month - 1, day - weekday))
  return pacificDayStart(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

export function growthWindows(now: Date = new Date()): GrowthWindow[] {
  const { year, month } = pacificYmd(now)

  const weekStart = pacificWeekStart(now)
  const priorWeekStart = new Date(weekStart.getTime())
  {
    const w = pacificYmd(weekStart)
    const shifted = new Date(Date.UTC(w.year, w.month - 1, w.day - 7))
    priorWeekStart.setTime(
      pacificDayStart(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()).getTime(),
    )
  }

  const monthStart = pacificDayStart(year, month, 1)
  const priorMonthStart = month === 1
    ? pacificDayStart(year - 1, 12, 1)
    : pacificDayStart(year, month - 1, 1)

  const yearStart = pacificDayStart(year, 1, 1)
  const priorYearStart = pacificDayStart(year - 1, 1, 1)

  const build = (
    key: GrowthPeriodKey,
    label: string,
    priorLabel: string,
    start: Date,
    priorStart: Date,
  ): GrowthWindow => ({
    key,
    label,
    priorLabel,
    start,
    end: now,
    priorStart,
    // Same elapsed span, measured from the prior period's own boundary.
    priorEnd: new Date(priorStart.getTime() + (now.getTime() - start.getTime())),
  })

  return [
    build('week', 'This week', 'last week to date', weekStart, priorWeekStart),
    build('month', 'This month', 'last month to date', monthStart, priorMonthStart),
    build('year', 'This year', 'last year to date', yearStart, priorYearStart),
  ]
}

/** Oldest instant any window touches — the single fetch floor. */
export function growthFloor(windows: GrowthWindow[]): Date {
  return new Date(Math.min(...windows.map((w) => w.priorStart.getTime())))
}

export interface GrowthCount {
  current: number
  prior: number
}

/**
 * Bucket creation timestamps into each window's current/prior counts.
 *
 * One pass over the rows rather than two counts per window per entity —
 * the windows overlap (this week is inside this month is inside this
 * year), so a row is simply tested against each.
 */
export function bucketByWindows(
  createdAts: Date[],
  windows: GrowthWindow[],
): Record<GrowthPeriodKey, GrowthCount> {
  const out = {} as Record<GrowthPeriodKey, GrowthCount>
  for (const w of windows) out[w.key] = { current: 0, prior: 0 }
  for (const at of createdAts) {
    const t = at.getTime()
    for (const w of windows) {
      if (t >= w.start.getTime() && t < w.end.getTime()) out[w.key].current++
      else if (t >= w.priorStart.getTime() && t < w.priorEnd.getTime()) out[w.key].prior++
    }
  }
  return out
}
