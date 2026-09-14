/**
 * Guards the closed-day handoff question.
 *
 * Wes 2026-09-13: "We are closed on sundays, so all pickups and returns
 * on that day should be asked: Is this a blind pickup/dropoff?"
 *
 * Two ways this silently stops asking, both worth a test:
 *
 * 1. TIMEZONE. Order dates are `@db.Date` — midnight UTC. Read in
 *    Pacific, a Sunday renders as the Saturday before, and the question
 *    is never asked for the exact days it exists for. Same class of bug
 *    as the quote email that sent a Sept 29 pickup out as "September 28".
 * 2. A STALE ANSWER. The rep answers "blind" for a Sunday, then moves
 *    the date to Monday. The answer must not ride along onto the order —
 *    a staffed Monday pickup marked blind puts gate and lockbox codes on
 *    the client's portal for no reason.
 *
 *   npm run test:closed-day
 */
import {
  NO_CLOSED_DAY_ANSWERS,
  blindFlagsFor,
  closedDayAsks,
  closedDayBlockers,
  pruneClosedDayAnswers,
} from '@/lib/orders/closedDayHandoff'
import { isClosedDay, calendarDayLabel, weekdayOfCalendarDay } from '@/lib/site/yardHours'

let fail = 0
function ok(label: string, cond: boolean, detail = '') {
  if (!cond) fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

// 2026-09-13 is a Sunday; 2026-09-14 a Monday; 2026-09-12 a Saturday.
const SUN = '2026-09-13'
const MON = '2026-09-14'
const SAT = '2026-09-12'

console.log('— which days are closed —')
ok('Sunday is closed', isClosedDay(SUN))
ok('Monday is open', !isClosedDay(MON))
ok('Saturday is open — the yard runs 7:00–3:30', !isClosedDay(SAT))
ok('no date asks nothing', !isClosedDay(null) && !isClosedDay(undefined) && !isClosedDay(''))
ok('garbage asks nothing', !isClosedDay('not-a-date') && !isClosedDay(new Date('nope')))

console.log('\n— @db.Date values are read in UTC, not Pacific —')
ok('a midnight-UTC Sunday is a Sunday', isClosedDay(new Date(`${SUN}T00:00:00.000Z`)))
ok('…and its Monday neighbour is not', !isClosedDay(new Date(`${MON}T00:00:00.000Z`)))
ok('an ISO timestamp string is read off its date part', isClosedDay(`${SUN}T00:00:00.000Z`))
ok('weekday numbering is Sunday=0', weekdayOfCalendarDay(SUN) === 0 && weekdayOfCalendarDay(MON) === 1)
ok('the day is named back in UTC', calendarDayLabel(SUN) === 'Sunday, September 13', String(calendarDayLabel(SUN)))

console.log('\n— the question —')
ok('a Sunday pickup is asked about', closedDayAsks(SUN, MON).pickup)
ok('a weekday return is not', !closedDayAsks(SUN, MON).dropoff)
ok('a Sunday return is asked about', closedDayAsks(MON, SUN).dropoff)
ok('an all-weekday window asks nothing', closedDayBlockers(MON, MON, NO_CLOSED_DAY_ANSWERS).length === 0)
ok('a Sunday window blocks until answered', closedDayBlockers(SUN, SUN, NO_CLOSED_DAY_ANSWERS).length === 2)
ok(
  'answering one still blocks on the other',
  closedDayBlockers(SUN, SUN, { pickup: 'BLIND', dropoff: null }).length === 1,
)
ok(
  'STAFFED is an answer, not a non-answer',
  closedDayBlockers(SUN, SUN, { pickup: 'STAFFED', dropoff: 'STAFFED' }).length === 0,
)

console.log('\n— what lands on the order —')
ok(
  'blind Sunday pickup sets blindPickup only',
  JSON.stringify(blindFlagsFor(SUN, MON, { pickup: 'BLIND', dropoff: null })) ===
    JSON.stringify({ blindPickup: true, blindReturn: false }),
)
ok(
  'we-meet-them sets nothing',
  JSON.stringify(blindFlagsFor(SUN, SUN, { pickup: 'STAFFED', dropoff: 'STAFFED' })) ===
    JSON.stringify({ blindPickup: false, blindReturn: false }),
)
ok(
  'both ends blind sets both columns',
  JSON.stringify(blindFlagsFor(SUN, SUN, { pickup: 'BLIND', dropoff: 'BLIND' })) ===
    JSON.stringify({ blindPickup: true, blindReturn: true }),
)
ok(
  'an answer for a date that moved to a weekday never reaches the order',
  blindFlagsFor(MON, MON, { pickup: 'BLIND', dropoff: 'BLIND' }).blindPickup === false,
)

console.log('\n— a moved date drops its answer —')
ok(
  'Sunday → Monday clears the pickup answer',
  pruneClosedDayAnswers(MON, SUN, { pickup: 'BLIND', dropoff: 'BLIND' }).pickup === null,
)
ok(
  '…and leaves the still-Sunday return alone',
  pruneClosedDayAnswers(MON, SUN, { pickup: 'BLIND', dropoff: 'BLIND' }).dropoff === 'BLIND',
)
const stable = { pickup: 'BLIND', dropoff: null } as const
ok(
  'nothing to prune returns the same object (safe to derive every render)',
  pruneClosedDayAnswers(SUN, MON, stable) === stable,
)

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILED`}`)
process.exit(fail === 0 ? 0 : 1)
