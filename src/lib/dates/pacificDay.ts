/**
 * TODAY, in the yard's time zone — the one rule.
 *
 * Wes, 2026-09-16 at 5:40pm in Sun Valley: "It seems like HQ thinks today
 * is 9/18." It did, by way of 9/17: a dozen screens took today's date from
 * `new Date().toISOString().slice(0, 10)`, which is the date in UTC, and
 * UTC rolls over at 5pm Pacific (4pm in winter). From then until midnight
 * the reservations board's today column, the jobs board's "picking up
 * today" / "tomorrow", the calendar's today ring and the default start
 * date on a new reservation all sat a day ahead of the wall clock — and
 * anything they called "tomorrow" was the day after that.
 *
 * SirReel operates in one time zone, so today is America/Los_Angeles,
 * wherever the server runs and whatever the browser's clock says. This
 * module is pure (no prisma, no React) so a client component and a route
 * can both import it and a test can pin the clock.
 */

export const YARD_TIME_ZONE = 'America/Los_Angeles'

const ymdFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: YARD_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** YYYY-MM-DD in America/Los_Angeles, offset by N calendar days. `now`
 *  exists so a test can pin the clock; nothing passes it in app code. */
export function pacificYmd(offsetDays = 0, now: number = Date.now()): string {
  return ymdFormat.format(new Date(now + offsetDays * 86_400_000))
}

/** Today and tomorrow, the pair the cadence math compares against. */
export function pacificDays(now: number = Date.now()): { today: string; tomorrow: string } {
  return { today: pacificYmd(0, now), tomorrow: pacificYmd(1, now) }
}

/** Today's month as YYYY-MM, in the same zone. */
export function pacificYm(now: number = Date.now()): string {
  return pacificYmd(0, now).slice(0, 7)
}
