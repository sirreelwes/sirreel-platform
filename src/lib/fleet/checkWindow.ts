/**
 * The day windows the check lists run on — and the Pacific-day helpers
 * they are built from. Deliberately prisma-free.
 *
 * These lived in todayBoard.ts, which imports `@/lib/prisma` at the top
 * level — and `@/lib/prisma` CONSTRUCTS a client at import time. So
 * nothing could exercise a window without standing up a database first,
 * which is the same reason yardHours.ts exists as its own module. The
 * arithmetic that decides whether Friday is still on the board is worth
 * being able to test on its own. todayBoard re-exports all of it, so
 * every existing importer is unaffected.
 */

import { isClosedDay } from '@/lib/site/yardHours'
import { pacificYmd } from '@/lib/dates/pacificDay'

// The helper itself lives in lib/dates/pacificDay.ts (2026-09-16) so every
// screen's "today" is the same function; re-exported so the importers of
// this module keep working.
export { pacificYmd }

/**
 * Never walk back further than this past the budget, whatever the
 * closure calendar says. A window is a work queue, not an archive.
 */
const MAX_EXTRA_LOOKBACK = 7

/**
 * The days a check list covers — backward in days the yard actually
 * WORKS, forward in calendar days.
 *
 * Oliver, 2026-09-14: "Fox Sports Cube 33 returned on Friday. Julian
 * wants to check it in, but it's not visible in the vehicle check in/out
 * tab." It wasn't. The list reached a fixed number of CALENDAR days
 * back, and by Monday morning Friday is three of them — so every truck
 * that came back on a Friday and wasn't checked in before the weekend
 * fell off the board over it, with no other route to the return screen.
 * Cube 33 and Cargo 33 both went dark that way on 2026-09-11.
 *
 * The weekend is the bug: a day the yard is dark cannot be a day anyone
 * filed a report, so spending budget on it shortens the window by
 * exactly the stretch it was meant to survive. Closed days are now
 * spanned for free (`isClosedDay` — Sunday today, and whatever holiday
 * joins CLOSED_WEEKDAYS later). Monday therefore always reaches back
 * through Friday, and keeps doing so when the calendar changes, which a
 * bigger constant would not.
 *
 * Forward stays calendar: a planning horizon is calendar time, and
 * nobody is surprised to see Saturday's departures on a Thursday.
 */
export function checkWindowYmds(
  daysBack: number,
  daysForward: number,
  now: number = Date.now(),
): string[] {
  const back: string[] = []
  let open = 0
  for (let i = 1; i <= daysBack + MAX_EXTRA_LOOKBACK && open < daysBack; i++) {
    const ymd = pacificYmd(-i, now)
    back.push(ymd)
    if (!isClosedDay(ymd)) open++
  }
  back.reverse()
  for (let i = 0; i <= daysForward; i++) back.push(pacificYmd(i, now))
  return back
}

/** BookingAssignment.startDate/endDate are @db.Date (UTC-midnight) — match on that. */
export const ymdToDbDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

