/**
 * Why a reserved truck does not show on the order line.
 *
 *   npx tsx tests/orders/line-unit-claim.test.ts
 *   npm run test:line-unit-claim
 *
 * Pure + offline: no DB, no AI, no env.
 *
 * The report this pins (Wes 2026-09-19): "Cargo 35 is a reservation for
 * this job, but the order says Equipment—cargo (not assigned) when it's
 * the same vehicle." The line read "Held · no unit" while the unit picker
 * called the same block fully assigned — two rules reading one row.
 *
 * The blocker order has to match `unitsForLine` / `liveUnitsForLine`
 * exactly, or the chip explains a claim the page did not actually make.
 */

import { claimBlockerFor, canTieToLine, claimBlockerWords, type ClaimAssignment, type ClaimLine } from '../../src/lib/orders/lineUnitClaim'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const LINE: ClaimLine = {
  id: 'line-1',
  orderId: 'order-A',
  pickupDate: '2026-09-17T00:00:00.000Z',
  returnDate: '2026-09-21T00:00:00.000Z',
}

const cargo35 = (over: Partial<ClaimAssignment> = {}): ClaimAssignment => ({
  orderId: 'order-A',
  orderLineItemId: null,
  startDate: '2026-09-17T00:00:00.000Z',
  endDate: '2026-09-21T00:00:00.000Z',
  asset: { unitName: 'Cargo 35' },
  ...over,
})

console.log('Why a reserved unit is not on the line\n')

// ── The board's ambiguous case — the one this was reported for ──────────
// `assignUnit` writes orderId: null whenever more than one order on the job
// overlaps the hold. Every line then fails the orderId half of the claim,
// so a real reservation is invisible on every order of the job.
const unattached = cargo35({ orderId: null })
check(
  'a unit on the hold with no order reads as unattached, not as missing',
  claimBlockerFor(unattached, LINE) === 'unattached',
)
check(
  'and it is the one case a person can resolve in one tap',
  canTieToLine(unattached, LINE) === true,
)
check(
  'the words say where it actually is',
  claimBlockerWords('unattached', unattached).includes('not tied to an order'),
)

// ── The cases that must NOT offer a one-tap steal ───────────────────────
const otherOrder = cargo35({ orderId: 'order-B', order: { orderNumber: 'S260914-021' } })
check(
  'a unit going out on a sibling order is named, never claimed',
  claimBlockerFor(otherOrder, LINE) === 'other-order' && canTieToLine(otherOrder, LINE) === false,
)
check(
  'and the sentence names the order, so the yard can be asked',
  claimBlockerWords('other-order', otherOrder).includes('S260914-021'),
)
const otherLine = cargo35({ orderLineItemId: 'line-2' })
check(
  'a unit stamped to another line of this order is not up for grabs',
  claimBlockerFor(otherLine, LINE) === 'other-line' && canTieToLine(otherLine, LINE) === false,
)
// Exact-day matching on BOTH ends is the claim rule; a block that moved
// leaves the truck on the old days and the line claiming nothing.
const movedDays = cargo35({ startDate: '2026-09-20T00:00:00.000Z' })
check(
  'this order’s own unit on different days is a date mismatch, not a missing truck',
  claimBlockerFor(movedDays, LINE) === 'other-dates' && canTieToLine(movedDays, LINE) === false,
)
check(
  'and the sentence prints the days it IS reserved for',
  claimBlockerWords('other-dates', movedDays).includes('2026-09-20'),
)
// An unattached row whose days do not match is still not one tap: attaching
// the order would not make the line claim it, and the chip must not promise
// a fix that leaves the row exactly as it was.
check(
  'an unattached unit on different days is NOT tieable',
  canTieToLine(cargo35({ orderId: null, endDate: '2026-09-25T00:00:00.000Z' }), LINE) === false,
)

// ── The stamp settles it before anything else is read ───────────────────
check(
  'a unit stamped with THIS line is the line’s own',
  claimBlockerFor(cargo35({ orderLineItemId: 'line-1' }), LINE) === 'over-quantity',
)
check(
  'the stamp wins over a mismatched order — the same short-circuit unitsForLine makes',
  claimBlockerFor(cargo35({ orderLineItemId: 'line-1', orderId: 'order-B' }), LINE) === 'over-quantity',
)
check(
  'a clean extra unit past the line’s quantity is nobody’s fault',
  claimBlockerFor(cargo35(), LINE) === 'over-quantity',
)
check(
  'only the calendar day is compared, never the timestamp',
  claimBlockerFor(cargo35({ startDate: '2026-09-17T18:30:00.000Z' }), LINE) === 'over-quantity',
)

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All line-unit-claim checks passed.')
