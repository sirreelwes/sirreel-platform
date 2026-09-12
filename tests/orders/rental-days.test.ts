/**
 * Calendar-day count tests — the denominator under "Days" on an order.
 *
 *   npx tsx tests/orders/rental-days.test.ts
 *   npm run test:rental-days
 *
 * Pure + offline.
 *
 * Origin (Wes, forwarded 2026-09-12): a cargo van Sep 14 → Sep 16 read
 * "3/2" under Days — billing 3 of a 2-day rental, which looks like an
 * overcharge. The billed count (estimateRentalDays) was inclusive while
 * the stored span (computeDays) was the exclusive gap. Every count here
 * must agree: the days a rental TOUCHES, both ends included.
 */
import assert from 'node:assert/strict'
import { computeDays } from '../../src/lib/orders/days'
import { calendarDays } from '../../src/lib/orders/billing'
import { rentalDays, estimateRentalDays } from '../../src/lib/orders'

const d = (s: string) => new Date(`${s}T00:00:00Z`)
let n = 0
const check = (name: string, fn: () => void) => { fn(); n++; console.log(`  ok  ${name}`) }

check('Sep 14 → Sep 16 is 3 days everywhere', () => {
  assert.equal(computeDays(d('2026-09-14'), d('2026-09-16')), 3)
  assert.equal(computeDays('2026-09-14', '2026-09-16'), 3)
  assert.equal(calendarDays(d('2026-09-14'), d('2026-09-16')), 3)
  assert.equal(rentalDays(d('2026-09-14'), d('2026-09-16')), 3)
  assert.equal(estimateRentalDays(d('2026-09-14'), d('2026-09-16'), 'cargo-van'), 3)
})

check('same-day rental is 1 day, never 0', () => {
  assert.equal(computeDays(d('2026-09-14'), d('2026-09-14')), 1)
  assert.equal(calendarDays(d('2026-09-14'), d('2026-09-14')), 1)
})

check('the stored span never sits below the billed count on create', () => {
  // The "3/2" defect: billed (inclusive) > span (exclusive). The span is
  // the calendar ceiling, so billed at the standard week can never
  // exceed it.
  for (const [a, b] of [['2026-09-14', '2026-09-16'], ['2026-09-01', '2026-09-11'], ['2026-09-30', '2026-10-01']]) {
    const span = computeDays(d(a), d(b))
    assert.ok(estimateRentalDays(d(a), d(b), null) <= span, `${a}→${b}`)
    assert.ok(estimateRentalDays(d(a), d(b), 'cube-truck') <= span, `${a}→${b} cube`)
  }
})

check('cube truck on 24-hour billing reads 2/3, not 2/2', () => {
  // truckRentalDays: 3 calendar days → 2 billed (half-day ends).
  assert.equal(estimateRentalDays(d('2026-09-14'), d('2026-09-16'), 'cube-truck'), 2)
  assert.equal(computeDays(d('2026-09-14'), d('2026-09-16')), 3)
})

check('time of day on a @db.Date column does not shift the count', () => {
  // A west-coast Date for a Sep 14 @db.Date value can carry 07:00Z; the
  // span is still the dates, not the hours.
  assert.equal(computeDays(new Date('2026-09-14T07:00:00Z'), new Date('2026-09-16T07:00:00Z')), 3)
  assert.equal(calendarDays(new Date('2026-09-14T07:00:00Z'), new Date('2026-09-16T07:00:00Z')), 3)
})

console.log(`\n${n} checks passed`)
