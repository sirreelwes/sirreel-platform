/**
 * Wrong-year repair on parsed quote dates.
 *   npm run test:parsed-year
 *
 * Three orders in two days were quoted to clients with dates in the
 * past, because the parser's prompt asks for "YYYY-MM-DD" and never says
 * what year it is. The two that reached a client:
 *
 *   S260831-005 JUST PONDS       2024-09-17  (714 days past)
 *   S260831-009 Hulu Chad Powers 2025-09-04  (362 days past)
 *
 * The dangerous direction is over-correction: quotes ARE written up
 * after a rental starts, and silently rolling those forward would
 * invent a booking that never happened.
 */

import {
  correctImpossibleYear, hasImpossibleYear, IMPOSSIBLE_PAST_DAYS,
} from '../../src/lib/orders/parsedDateYear'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}
const TODAY = '2026-09-01'

console.log('The two real cases')
check(correctImpossibleYear('2024-09-17', TODAY) === '2026-09-17',
  'JUST PONDS: 2024-09-17 rolls two years to 2026-09-17 — the date Wes confirmed')
check(correctImpossibleYear('2025-09-04', TODAY) === '2026-09-04',
  'Chad Powers: 2025-09-04 rolls one year to 2026-09-04')

console.log('\nOrdinary dates are left alone')
check(correctImpossibleYear('2026-09-04', TODAY) === '2026-09-04', 'a future date is untouched')
check(correctImpossibleYear('2026-09-01', TODAY) === '2026-09-01', 'today is untouched')
check(correctImpossibleYear('2026-08-25', TODAY) === '2026-08-25',
  'a week ago is untouched — quotes are written up after the fact and that is not an error')
check(correctImpossibleYear('2026-04-01', TODAY) === '2026-04-01',
  `${IMPOSSIBLE_PAST_DAYS} days is the line; five months back stays put`)

console.log('\nThe boundary')
check(correctImpossibleYear('2026-03-05', TODAY) === '2026-03-05', '180 days past is still plausible')
check(correctImpossibleYear('2026-03-04', TODAY) === '2027-03-04', 'a day beyond it is corrected')

console.log('\nNulls and junk pass through without inventing a date')
check(correctImpossibleYear(null, TODAY) === null, 'null in, null out')
check(correctImpossibleYear(undefined, TODAY) === null, 'undefined too')
check(correctImpossibleYear('', TODAY) === null, 'empty string')
check(correctImpossibleYear('next Tuesday', TODAY) === null,
  'unparseable text yields null rather than a guessed date')

console.log('\nIt reports what it would do')
check(hasImpossibleYear('2025-09-04', TODAY), 'flags the Chad Powers date')
check(!hasImpossibleYear('2026-09-04', TODAY), 'does not flag a good one')
check(!hasImpossibleYear(null, TODAY), 'a missing date is not a wrong year')

console.log('\nIt terminates on absurd input')
check(correctImpossibleYear('1970-01-01', TODAY) === '1990-01-01',
  'the 20-iteration bound stops rather than spinning — it does not have to reach today, only to stop')

console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll parsed-year tests passed.')
process.exitCode = failures.length ? 1 : 0
