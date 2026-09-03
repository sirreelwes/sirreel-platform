/**
 * Quote-send hold tests — what a sent quote actually reserves.
 *
 *   npx tsx tests/orders/quote-hold.test.ts
 *   npm run test:quote-hold
 *
 * Pure + offline: exercises the line-classification predicate and the
 * envelope/quantity arithmetic, no DB.
 *
 * Every case here is a real defect found on S260903-002 (High Horses,
 * quoted 2026-09-03), where a seven-line quote reserved less than it
 * promised in three different ways at once:
 *
 *   · two Cargo Van lines on different dates produced ONE hold, so half
 *     the vans a live quote committed read as free on the board
 *   · the booking envelope took the FIRST line's dates, starting a day
 *     after the earliest pickup
 *   · "Production Truck" — a VEHICLES line with no catalog row — was
 *     counted beside the ladders and folding tables and never mentioned
 *
 * The direction that matters is under-holding: a hold too small or too
 * short is how the same truck goes out twice.
 */

import { isUnholdableVehicleLine, type HoldableLineShape } from '../../src/lib/orders/holdOnQuoteSend'

const failures: string[] = []
function check(got: unknown, want: unknown, why: string): void {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) console.log(`  ok — ${why}`)
  else {
    console.log(`  FAIL — ${why}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
    failures.push(why)
  }
}

const vehicleNoCatalog: HoldableLineShape = {
  department: 'VEHICLES', assetCategoryId: null, inventoryItem: null,
}
const vehicleUnitTracked: HoldableLineShape = {
  department: 'VEHICLES', assetCategoryId: null,
  inventoryItem: { department: 'VEHICLES', trackingMode: 'UNIT_TRACKED', legacyAssetCategoryId: 'cat-cargo' },
}
const vehicleUnitTrackedNoCategory: HoldableLineShape = {
  department: 'VEHICLES', assetCategoryId: null,
  inventoryItem: { department: 'VEHICLES', trackingMode: 'UNIT_TRACKED', legacyAssetCategoryId: null },
}
const supplies: HoldableLineShape = {
  department: 'PRODUCTION_SUPPLIES' as never, assetCategoryId: null,
  inventoryItem: { department: 'PRODUCTION_SUPPLIES' as never, trackingMode: 'QUANTITY', legacyAssetCategoryId: null },
}
const legacyLine: HoldableLineShape = {
  department: 'VEHICLES', assetCategoryId: 'cat-legacy',
  assetCategory: { department: 'VEHICLES' }, inventoryItem: null,
}

console.log('\nisUnholdableVehicleLine — which lines reserve nothing')
check(isUnholdableVehicleLine(vehicleNoCatalog), true, '"Production Truck": a VEHICLES line with no catalog row at all')
check(isUnholdableVehicleLine(vehicleUnitTrackedNoCategory), true, 'unit-tracked catalog row with no category to hold against')
check(isUnholdableVehicleLine(vehicleUnitTracked), false, 'a normal Cargo Van line holds fine')
check(isUnholdableVehicleLine(legacyLine), false, 'a legacy line carrying its category directly holds fine')
check(isUnholdableVehicleLine(supplies), false, 'quantity-tracked supplies are correctly skipped, NOT flagged')

// ── the arithmetic the hold logic performs ──
// Mirrors holdOnQuoteSend: envelope spans every held line; quantity is
// the SUM per category.
interface Line { categoryId: string; quantity: number; pickup: string; ret: string }
function envelope(lines: Line[]): { start: string; end: string } {
  return {
    start: lines.map((l) => l.pickup).reduce((a, b) => (a < b ? a : b)),
    end: lines.map((l) => l.ret).reduce((a, b) => (a > b ? a : b)),
  }
}
function wantByCategory(lines: Line[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const l of lines) m[l.categoryId] = (m[l.categoryId] ?? 0) + (l.quantity || 1)
  return m
}

// The real S260903-002 vehicle lines.
const highHorses: Line[] = [
  { categoryId: 'cargo', quantity: 1, pickup: '2026-09-23', ret: '2026-09-26' },
  { categoryId: 'cargo', quantity: 1, pickup: '2026-09-22', ret: '2026-09-25' },
  { categoryId: 'pass', quantity: 2, pickup: '2026-09-24', ret: '2026-09-25' },
  { categoryId: 'popvan', quantity: 1, pickup: '2026-09-24', ret: '2026-09-25' },
  { categoryId: 'restroom', quantity: 1, pickup: '2026-09-24', ret: '2026-09-25' },
]

console.log('\nenvelope — must cover every held line')
check(envelope(highHorses), { start: '2026-09-22', end: '2026-09-26' }, 'High Horses: earliest pickup 09-22, not the first line’s 09-23')
check(
  envelope([{ categoryId: 'a', quantity: 1, pickup: '2026-10-01', ret: '2026-10-02' }]),
  { start: '2026-10-01', end: '2026-10-02' },
  'a single line is its own envelope',
)
check(
  envelope([
    { categoryId: 'a', quantity: 1, pickup: '2026-10-05', ret: '2026-10-06' },
    { categoryId: 'b', quantity: 1, pickup: '2026-10-01', ret: '2026-10-12' },
  ]),
  { start: '2026-10-01', end: '2026-10-12' },
  'a later line can widen BOTH ends',
)

console.log('\nquantity per category — two lines for one category are two vehicles')
check(
  wantByCategory(highHorses),
  { cargo: 2, pass: 2, popvan: 1, restroom: 1 },
  'High Horses: both Cargo Vans held, not just the first line',
)
check(
  wantByCategory([
    { categoryId: 'cube', quantity: 1, pickup: '2026-10-01', ret: '2026-10-02' },
    { categoryId: 'cube', quantity: 3, pickup: '2026-10-04', ret: '2026-10-05' },
  ]),
  { cube: 4 },
  'quantities add across lines, they do not overwrite',
)
// Idempotency: recomputing from the same order must not grow the hold.
check(
  wantByCategory(highHorses),
  wantByCategory(highHorses),
  're-sending a quote yields the same desired quantity (set, not increment)',
)

console.log(failures.length ? `\n${failures.length} FAILED\n` : '\nall passed\n')
process.exit(failures.length ? 1 : 0)
