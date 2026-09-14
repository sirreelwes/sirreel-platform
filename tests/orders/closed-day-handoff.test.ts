/**
 * Guards the out-of-hours handoff question.
 *
 * Wes 2026-09-13: "We are closed on sundays, so all pickups and returns
 * on that day should be asked: Is this a blind pickup/dropoff?" — and
 * 2026-09-14: "Also ask on Saturday after 3:30."
 *
 * Three ways this silently stops asking (or asks wrongly), all worth a
 * test:
 *
 * 1. TIMEZONE. Order dates are `@db.Date` — midnight UTC. Read in
 *    Pacific, a Sunday renders as the Saturday before: the question
 *    changes shape on the exact days it exists for. Same class of bug as
 *    the quote email that sent a Sept 29 pickup out as "September 28".
 * 2. A STALE ANSWER. The rep answers, then moves the date. An answer
 *    must not ride along onto a different day — a staffed Monday pickup
 *    marked blind puts gate and lockbox codes on the client's portal for
 *    nothing, and a Sunday "blind" carried onto a Saturday asserts an
 *    after-3:30 handoff nobody said.
 * 3. SATURDAY FLATTENED INTO SUNDAY. Saturday is staffed until 3:30, so
 *    its first question is the TIME, and "before 3:30" must close the
 *    question while setting nothing.
 *
 *   npm run test:closed-day
 */
import {
  NO_CLOSED_DAY_ANSWERS,
  answerStands,
  blindFlagsFor,
  closedDayAsks,
  closedDayBlockers,
  pruneClosedDayAnswers,
  type ClosedDayHandoff,
} from '@/lib/orders/closedDayHandoff'
import {
  isClosedDay,
  closureOn,
  calendarDayLabel,
  weekdayOfCalendarDay,
} from '@/lib/site/yardHours'

let fail = 0
function ok(label: string, cond: boolean, detail = '') {
  if (!cond) fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

// 2026-09-12 is a Saturday, 09-13 a Sunday, 09-14 a Monday, 09-19 the
// Saturday after.
const SAT = '2026-09-12'
const SUN = '2026-09-13'
const MON = '2026-09-14'
const NEXT_SAT = '2026-09-19'

const on = (day: string, answer: 'BLIND' | 'STAFFED' | 'IN_HOURS') => ({ day, answer }) as const
const answers = (pickup: ClosedDayHandoff['pickup'], dropoff: ClosedDayHandoff['dropoff'] = null) =>
  ({ pickup, dropoff }) as ClosedDayHandoff

console.log('— when the yard is shut —')
ok('Sunday is dark all day', closureOn(SUN)?.kind === 'CLOSED_ALL_DAY')
ok('Saturday closes early, at 3:30 PM', JSON.stringify(closureOn(SAT)) === JSON.stringify({ kind: 'AFTER_CLOSE', closesAt: '3:30 PM' }))
ok('Monday is a normal day', closureOn(MON) === null)
ok('a Saturday is not "closed" — it closes', !isClosedDay(SAT) && isClosedDay(SUN))
ok('no date is no closure', closureOn(null) === null && closureOn('') === null)
ok('garbage is no closure', closureOn('not-a-date') === null && closureOn(new Date('nope')) === null)

console.log('\n— @db.Date values are read in UTC, not Pacific —')
ok('a midnight-UTC Sunday is a Sunday', isClosedDay(new Date(`${SUN}T00:00:00.000Z`)))
ok('…and its Saturday neighbour is not', !isClosedDay(new Date(`${SAT}T00:00:00.000Z`)))
ok('an ISO timestamp string is read off its date part', isClosedDay(`${SUN}T00:00:00.000Z`))
ok('weekday numbering is Sunday=0', weekdayOfCalendarDay(SUN) === 0 && weekdayOfCalendarDay(SAT) === 6)
ok('the day is named back in UTC', calendarDayLabel(SUN) === 'Sunday, September 13', String(calendarDayLabel(SUN)))

console.log('\n— what gets asked —')
ok('a Sunday pickup is asked about', closedDayAsks(SUN, MON).pickup?.kind === 'CLOSED_ALL_DAY')
ok('a Saturday return is asked about', closedDayAsks(MON, SAT).dropoff?.kind === 'AFTER_CLOSE')
ok('a weekday end is not', closedDayAsks(SUN, MON).dropoff === null)
ok('an all-weekday window asks nothing', closedDayBlockers(MON, MON, NO_CLOSED_DAY_ANSWERS).length === 0)
ok('a Sunday window blocks until answered', closedDayBlockers(SUN, SUN, NO_CLOSED_DAY_ANSWERS).length === 2)
ok(
  'Sunday is asked whether it is blind',
  closedDayBlockers(SUN, MON, NO_CLOSED_DAY_ANSWERS)[0] === 'is the Sunday pickup blind?',
)
ok(
  'Saturday is asked the TIME first — it is staffed until 3:30',
  closedDayBlockers(SAT, MON, NO_CLOSED_DAY_ANSWERS)[0] === 'what time is the Saturday pickup?',
)
ok(
  'answering one end still blocks on the other',
  closedDayBlockers(SUN, SUN, answers(on(SUN, 'BLIND'))).length === 1,
)
ok(
  'STAFFED is an answer, not a non-answer',
  closedDayBlockers(SUN, SUN, answers(on(SUN, 'STAFFED'), on(SUN, 'STAFFED'))).length === 0,
)
ok(
  'before-3:30 answers the Saturday question',
  closedDayBlockers(SAT, MON, answers(on(SAT, 'IN_HOURS'))).length === 0,
)
ok(
  'before-3:30 is not sayable about a Sunday',
  !answerStands(SUN, closureOn(SUN), on(SUN, 'IN_HOURS')) &&
    closedDayBlockers(SUN, MON, answers(on(SUN, 'IN_HOURS'))).length === 1,
)

console.log('\n— what lands on the order —')
ok(
  'blind Sunday pickup sets blindPickup only',
  JSON.stringify(blindFlagsFor(SUN, MON, answers(on(SUN, 'BLIND')))) ===
    JSON.stringify({ blindPickup: true, blindReturn: false }),
)
ok(
  'after-3:30-and-blind on a Saturday sets it too',
  blindFlagsFor(SAT, MON, answers(on(SAT, 'BLIND'))).blindPickup === true,
)
ok(
  'before-3:30 sets NOTHING — the yard is open for it',
  blindFlagsFor(SAT, MON, answers(on(SAT, 'IN_HOURS'))).blindPickup === false,
)
ok(
  'we-meet-them sets nothing',
  JSON.stringify(blindFlagsFor(SUN, SUN, answers(on(SUN, 'STAFFED'), on(SUN, 'STAFFED')))) ===
    JSON.stringify({ blindPickup: false, blindReturn: false }),
)
ok(
  'both ends blind sets both columns',
  JSON.stringify(blindFlagsFor(SUN, SUN, answers(on(SUN, 'BLIND'), on(SUN, 'BLIND')))) ===
    JSON.stringify({ blindPickup: true, blindReturn: true }),
)

console.log('\n— a moved date drops its answer —')
ok(
  'Sunday → Monday clears the pickup answer',
  pruneClosedDayAnswers(MON, SUN, answers(on(SUN, 'BLIND'), on(SUN, 'BLIND'))).pickup === null,
)
ok(
  '…and leaves the still-Sunday return alone',
  pruneClosedDayAnswers(MON, SUN, answers(on(SUN, 'BLIND'), on(SUN, 'BLIND'))).dropoff?.answer === 'BLIND',
)
ok(
  'an answer never reaches the order once its date moved',
  blindFlagsFor(MON, MON, answers(on(SUN, 'BLIND'), on(SUN, 'BLIND'))).blindPickup === false,
)
ok(
  'a Sunday "blind" does not carry onto a Saturday — different question',
  pruneClosedDayAnswers(SAT, MON, answers(on(SUN, 'BLIND'))).pickup === null,
)
ok(
  'a Saturday "before 3:30" does not carry onto the next Saturday either',
  pruneClosedDayAnswers(NEXT_SAT, MON, answers(on(SAT, 'IN_HOURS'))).pickup === null,
)
const stable = answers(on(SUN, 'BLIND'))
ok(
  'nothing to prune returns the same object (safe to derive every render)',
  pruneClosedDayAnswers(SUN, MON, stable) === stable,
)

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILED`}`)
process.exit(fail === 0 ? 0 : 1)
