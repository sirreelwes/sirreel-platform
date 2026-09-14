/**
 * The backward reach of the check in/out lists, across a weekend.
 *
 * Oliver, 2026-09-14: "Fox Sports Cube 33 returned on Friday. Julian
 * wants to check it in, but it's not visible in the vehicle check in/out
 * tab." Cube 33 came back Friday 2026-09-11 and the list reached two
 * CALENDAR days back, so on Monday morning it started at Saturday. The
 * truck was on the lot, the return screen existed, and nothing on the
 * board would take you to it.
 *
 * A calendar count cannot survive a weekend, because the days it spends
 * are exactly the days nobody was there to file anything. So the budget
 * is spent on OPEN days and closed ones are spanned free. What this pins
 * is the property, not the constant: from any working day, the reach
 * covers the last N days the yard was actually open — which is the thing
 * that broke, and which a "bump it to 3" fix would satisfy on Monday and
 * break again on Tuesday.
 *
 * Run: npm run test:check-window
 */
import { checkWindowYmds } from '../../src/lib/fleet/checkWindow'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = Object.is(got, want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${got}${ok ? '' : ` (want ${want})`}`)
}

/** 16:00 UTC = 9am Pacific, safely mid-morning on the named day. */
const at = (ymd: string) => Date.parse(`${ymd}T16:00:00Z`)

// The vehicle list's own numbers.
const BACK = 3
const FORWARD = 6

const win = (ymd: string) => checkWindowYmds(BACK, FORWARD, at(ymd))
const startsAt = (ymd: string) => win(ymd)[0]

console.log('The reported bug — Monday must reach Friday:')
const monday = win('2026-09-14')
eq('  window starts       ', startsAt('2026-09-14'), '2026-09-10')
eq('  Friday 09-11 covered', monday.includes('2026-09-11'), true)
eq('  Sunday spanned free ', monday.includes('2026-09-13'), true)
eq('  today present       ', monday.includes('2026-09-14'), true)

console.log('\n...and keeps reaching it later in the week (a bigger constant would not):')
eq('  Tue reaches Fri 09-11', win('2026-09-15').includes('2026-09-11'), true)
eq('  Wed reaches Sat 09-12', win('2026-09-16').includes('2026-09-12'), true)

console.log('\nThe budget is open days, so a Sunday never costs one:')
// Mon 09-14 back through Thu 09-10 is FOUR calendar days for three open
// ones (Sat, Fri, Thu — Sunday is dark). A midweek day spends three.
const span = (ymd: string) =>
  Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${startsAt(ymd)}T00:00:00Z`)) / 86_400_000)
eq('  Monday  spans 4 calendar days', span('2026-09-14'), 4)
eq('  Thursday spans 3             ', span('2026-09-17'), 3)
eq('  Friday   spans 3             ', span('2026-09-18'), 3)

console.log('\nForward is calendar, and unchanged:')
eq('  last day is today + FORWARD', monday[monday.length - 1], '2026-09-20')

console.log('\nShape invariants:')
eq('  days are unique      ', new Set(monday).size, monday.length)
let ascending = true
for (let i = 1; i < monday.length; i++) if (!(monday[i] > monday[i - 1])) ascending = false
eq('  strictly ascending   ', ascending, true)
let contiguous = true
for (let i = 1; i < monday.length; i++) {
  const gap = Date.parse(`${monday[i]}T00:00:00Z`) - Date.parse(`${monday[i - 1]}T00:00:00Z`)
  if (gap !== 86_400_000) contiguous = false
}
// The page reads the window as a DATE RANGE from first to last, so a
// hole in the middle would silently widen it past what is listed.
eq('  contiguous, no holes ', contiguous, true)

console.log('\nAcross a month boundary, and in standard time:')
eq('  Oct 1 starts Sep 28', startsAt('2026-10-01'), '2026-09-28')
eq('  Mon Dec 7 reaches Fri Dec 4', win('2026-12-07').includes('2026-12-04'), true)

console.log('\nA zero-day budget asks for nothing behind today:')
eq('  starts today', checkWindowYmds(0, 2, at('2026-09-14'))[0], '2026-09-14')

console.log(fail === 0 ? '\nAll passed.' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
