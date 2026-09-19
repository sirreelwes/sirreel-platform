/**
 * The paperwork IS the booking — the rule, without the database.
 *
 *   npx tsx tests/orders/auto-book.test.ts
 *   npm run test:auto-book
 *
 * Pure + offline: no DB, no AI, no env. Exercises the two decisions that
 * are all judgement and no I/O — "has the client said yes to THIS order"
 * and "is this a historical row that books silently" — plus the status
 * sets, which are the difference between catching up an order and
 * regressing one.
 *
 * What it pins (Wes, 2026-09-19: auto-switch to booked once the rental
 * agreement and the COI are in):
 *   · a sibling order's signature papers the JOB, so it satisfies the
 *     agreement requirement — but it is NOT an answer to a quote this
 *     client has not responded to, and must not book it;
 *   · an order whose pickup day has passed books SILENTLY. It is the
 *     wrapped-job rows that started this, and "welcome to your booking"
 *     on a rental that is over is worse than the wrong status was;
 *   · DRAFT never auto-books, and nothing at or past BOOKED is touched.
 */

import {
  clientSaidYes,
  isHistorical,
  AUTO_BOOKABLE_FROM,
  AT_OR_PAST_BOOKED,
} from '../../src/lib/orders/autoBook'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const SIGNED = [{ contractType: 'RENTAL_AGREEMENT', status: 'SIGNED_BASELINE' }]
const SIGNED_OFFLINE = [{ contractType: 'RENTAL_AGREEMENT', status: 'SIGNED_OFFLINE' }]
const RELEASED_UNSIGNED = [{ contractType: 'RENTAL_AGREEMENT', status: 'PORTAL_RELEASED' }]
const STAGE_ONLY = [{ contractType: 'STAGE_CONTRACT', status: 'SIGNED_BASELINE' }]

console.log('Auto-book: has the client said yes?\n')

check(
  'a signature on this order is a yes, even from QUOTE_SENT',
  clientSaidYes('QUOTE_SENT', SIGNED),
)
check(
  'a countersigned paper agreement (SIGNED_OFFLINE) is a yes too',
  clientSaidYes('QUOTE_SENT', SIGNED_OFFLINE),
)
check(
  'APPROVED is a yes with no signature of its own — the sibling/annual case',
  clientSaidYes('APPROVED', RELEASED_UNSIGNED),
)
check(
  'a quote that is merely papered by a sibling is NOT a yes',
  !clientSaidYes('QUOTE_SENT', RELEASED_UNSIGNED),
)
check(
  'no agreement rows at all is not a yes',
  !clientSaidYes('QUOTE_SENT', []),
)
check(
  'a signed STAGE contract does not answer the rental quote',
  !clientSaidYes('QUOTE_SENT', STAGE_ONLY),
)

console.log('\nAuto-book: which rows go out silently?\n')

const now = new Date('2026-09-19T12:00:00Z')
check(
  "a rental that started last week books silently",
  isHistorical(new Date('2026-09-11T15:00:00Z'), now),
)
check(
  'an hour ago is already historical — the truck left',
  isHistorical(new Date('2026-09-19T11:00:00Z'), now),
)
check(
  'a pickup next month is a live booking: welcome + partner notices',
  !isHistorical(new Date('2026-10-14T15:00:00Z'), now),
)
check(
  'an order with no start date is treated as live, never silenced',
  !isHistorical(null, now),
)

console.log('\nAuto-book: which statuses are in play?\n')

check('QUOTE_SENT can auto-book', AUTO_BOOKABLE_FROM.has('QUOTE_SENT'))
check('APPROVED can auto-book', AUTO_BOOKABLE_FROM.has('APPROVED'))
check(
  'DRAFT never auto-books — nobody has seen that total',
  !AUTO_BOOKABLE_FROM.has('DRAFT'),
)
check(
  'CANCELLED never auto-books',
  !AUTO_BOOKABLE_FROM.has('CANCELLED'),
)
check(
  'nothing at or past BOOKED is also in the bookable set — no regressions',
  [...AT_OR_PAST_BOOKED].every((s) => !AUTO_BOOKABLE_FROM.has(s)),
)
check(
  'a wrapped order (INVOICED / CLOSED) reads as already booked, not as work',
  AT_OR_PAST_BOOKED.has('INVOICED') && AT_OR_PAST_BOOKED.has('CLOSED'),
)
check(
  'an order already out on the job reads as already booked',
  AT_OR_PAST_BOOKED.has('ON_JOB') && AT_OR_PAST_BOOKED.has('RETURNED'),
)

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All auto-book checks passed.')
