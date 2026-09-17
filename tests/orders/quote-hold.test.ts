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

import {
  isUnholdableVehicleLine, holdCategoryForLine, planHoldSyncOnLineEdit, type HoldableLineShape,
} from '../../src/lib/orders/holdOnQuoteSend'
import { peakConcurrent } from '../../src/lib/orders/peakConcurrentHold'

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
  type: 'EQUIPMENT', department: 'VEHICLES', assetCategoryId: null, inventoryItem: null,
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
// LCDW: a per-vehicle CHARGE. Carries department VEHICLES, which is why
// a department-only test flagged it on four live quotes as a missing
// truck — the exact false alarm that would teach someone to ignore the
// one line in the email that means "nothing is reserved".
const lcdwFee: HoldableLineShape = {
  type: 'FEE', department: 'VEHICLES', assetCategoryId: null, inventoryItem: null,
}
const subRentalVehicle: HoldableLineShape = {
  type: 'VEHICLE', department: 'VEHICLES', assetCategoryId: null, inventoryItem: null,
}
// "Production Truck" on S260903-002: a real truck typed EQUIPMENT on
// department VEHICLES. Allowing only type=VEHICLE dropped it back out of
// the report, which is why the rule excludes charges instead.
const mistypedTruck: HoldableLineShape = {
  type: 'EQUIPMENT', department: 'VEHICLES', assetCategoryId: null, inventoryItem: null,
}
const labourOnVehicles: HoldableLineShape = {
  type: 'LABOR', department: 'VEHICLES', assetCategoryId: null, inventoryItem: null,
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
check(isUnholdableVehicleLine(lcdwFee), false, 'LCDW is a FEE on department VEHICLES — a charge, never a missing truck')
check(isUnholdableVehicleLine(subRentalVehicle), true, 'a real VEHICLE line with no catalog row ("EcoFlux — Celebrity Motorhome") still flags')
check(isUnholdableVehicleLine(mistypedTruck), true, '"Production Truck" typed EQUIPMENT on department VEHICLES is still a truck')
check(isUnholdableVehicleLine(labourOnVehicles), false, 'labour billed against vehicles is not a unit to assign')

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

// ── A line EDIT and the hold (2026-09-17) ─────────────────────────────
// The row editor gated its hold branch on the line's own assetCategoryId,
// which a catalog-bound van leaves null — so 1 → 2 vans left the hold at 1
// and the capacity confirm never fired. The class now comes from
// holdCategoryForLine on both sides of the edit, and the write is the peak
// recompute, never a delta.
console.log('\nline edit — what the hold is owed')
check(
  holdCategoryForLine(vehicleUnitTracked),
  'cat-cargo',
  'a catalog-bound van (assetCategoryId null) resolves its class through the catalog row',
)
check(
  planHoldSyncOnLineEdit({ oldCategoryId: holdCategoryForLine(vehicleUnitTracked), newCategoryId: holdCategoryForLine(vehicleUnitTracked), oldQty: 1, newQty: 2 }),
  { feasibilityDelta: 1, recompute: true, releaseCategoryId: null },
  'catalog-bound van 1 → 2: the increase must fit, and the hold is recomputed',
)
check(
  planHoldSyncOnLineEdit({ oldCategoryId: 'cat-cargo', newCategoryId: 'cat-cargo', oldQty: 3, newQty: 1 }),
  { feasibilityDelta: 0, recompute: true, releaseCategoryId: null },
  'quantity down: nothing to ask about capacity, still recomputed',
)
check(
  planHoldSyncOnLineEdit({ oldCategoryId: 'cat-cargo', newCategoryId: 'cat-cargo', oldQty: 2, newQty: 2 }),
  { feasibilityDelta: 0, recompute: false, releaseCategoryId: null },
  'a rate or note edit on a held line owes the hold nothing',
)
check(
  planHoldSyncOnLineEdit({ oldCategoryId: 'cat-cargo', newCategoryId: 'cat-cube', oldQty: 2, newQty: 2 }),
  { feasibilityDelta: 2, recompute: true, releaseCategoryId: 'cat-cargo' },
  'class change: the WHOLE quantity must fit the new class, the old one is handed back',
)
check(
  planHoldSyncOnLineEdit({ oldCategoryId: null, newCategoryId: 'cat-cargo', oldQty: 1, newQty: 1 }),
  { feasibilityDelta: 1, recompute: true, releaseCategoryId: null },
  'a free-typed line bound to a real van starts holding it',
)
check(
  planHoldSyncOnLineEdit({ oldCategoryId: 'cat-cargo', newCategoryId: null, oldQty: 1, newQty: 1 }),
  { feasibilityDelta: 0, recompute: true, releaseCategoryId: 'cat-cargo' },
  'a van re-picked as a ladder stops holding the van',
)
check(
  planHoldSyncOnLineEdit({ oldCategoryId: holdCategoryForLine(supplies), newCategoryId: holdCategoryForLine(supplies), oldQty: 4, newQty: 9 }),
  { feasibilityDelta: 0, recompute: false, releaseCategoryId: null },
  'supplies never touch a hold, whatever the quantity does',
)
// Why the write is a recompute and not a delta: USC quoted ONE van for two
// separate blocks. Bumping the first block to 2 makes the peak 2 — a delta
// on a summed hold would say 3.
const d = (s: string) => new Date(`${s}T00:00:00Z`)
check(
  peakConcurrent([
    { start: d('2026-10-01'), end: d('2026-10-04'), quantity: 2 },
    { start: d('2026-10-10'), end: d('2026-10-13'), quantity: 1 },
  ]),
  2,
  'two sequential blocks, first bumped 1 → 2: the hold is the PEAK (2), not the sum (3)',
)
check(
  peakConcurrent([
    { start: d('2026-10-01'), end: d('2026-10-04'), quantity: 2 },
    { start: d('2026-10-03'), end: d('2026-10-06'), quantity: 1 },
  ]),
  3,
  'overlapping blocks still add up',
)

console.log(failures.length ? `\n${failures.length} FAILED\n` : '\nall passed\n')
process.exit(failures.length ? 1 : 0)
