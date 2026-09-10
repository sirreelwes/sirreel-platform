/**
 * Release-by-asset: the addressing and the arithmetic.
 *
 *   npx tsx tests/scheduling/hold-release-plan.test.ts
 *   npm run test:release-plan
 *
 * Pure + offline. What this guards is the bug it was written for (Wes
 * 2026-09-10): a BookingItem is a category LINE with a quantity, so
 * "2× Motorhome" holding Cube 10 and Cube 12 is one row. Releasing Cube
 * 12 off a Gantt bar used to release the row — Cube 10's assignment was
 * swapped too and it vanished off the board. The two failure directions
 * both matter:
 *
 *   · too WIDE  — a named release takes a sibling truck down (the bug)
 *   · too NARROW — the truck is freed but the line keeps its quantity,
 *     so the category still reads as booked and nobody can rent it
 */
import { holdRowId, parseHoldRowId, planUnitRelease } from '../../src/lib/scheduling/holdRelease'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}

console.log('\nholdRowId / parseHoldRowId — a row id can name PART of a line')
eq(holdRowId('item1', null), 'item1', 'a whole line is still the bare BookingItem id')
eq(holdRowId('item1', { assetId: 'cube10' }), 'item1::asset:cube10', 'a unit row names its asset')
eq(holdRowId('item1', 'pool'), 'item1::pool', 'the unassigned remainder has its own row')
eq(
  parseHoldRowId('item1'),
  { bookingItemId: 'item1', assetId: null, pooled: false, wholeLine: true },
  'a bare id round-trips as the whole line — every older caller keeps working',
)
eq(
  parseHoldRowId('item1::asset:cube10'),
  { bookingItemId: 'item1', assetId: 'cube10', pooled: false, wholeLine: false },
  'a unit row round-trips',
)
eq(
  parseHoldRowId('item1::pool'),
  { bookingItemId: 'item1', assetId: null, pooled: true, wholeLine: false },
  'a pooled row round-trips',
)
eq(
  parseHoldRowId('item1::something-new'),
  { bookingItemId: 'item1', assetId: null, pooled: false, wholeLine: true },
  'an unrecognised suffix degrades to the whole line, never to a silent no-op',
)

console.log('\nplanUnitRelease — release one truck, keep the other')
const twoUp = { quantity: 2, assignedAssetIds: ['cube10', 'cube12'] }
eq(
  planUnitRelease({ ...twoUp, releaseAssetIds: ['cube12'] }),
  { mode: 'UNITS', releaseAssetIds: ['cube12'], unmatchedAssetIds: [], newQuantity: 1, newStatus: 'ASSIGNED' },
  'THE BUG: releasing Cube 12 off a 2× line leaves Cube 10 assigned, line drops to 1',
)
eq(
  planUnitRelease({ ...twoUp, releaseAssetIds: ['cube10', 'cube12'] }),
  { mode: 'ITEM', releaseAssetIds: ['cube10', 'cube12'], unmatchedAssetIds: [], newQuantity: 0, newStatus: 'REQUESTED' },
  'ticking BOTH trucks is the whole-line release — one act, not two partials',
)
eq(
  planUnitRelease({ quantity: 1, assignedAssetIds: ['cube10'], releaseAssetIds: ['cube10'] }),
  { mode: 'ITEM', releaseAssetIds: ['cube10'], unmatchedAssetIds: [], newQuantity: 0, newStatus: 'REQUESTED' },
  'one truck off a one-truck line is the old whole-line behaviour, unchanged',
)
eq(
  planUnitRelease({ ...twoUp, releaseAssetIds: ['cube12', 'cube12'] }),
  { mode: 'UNITS', releaseAssetIds: ['cube12'], unmatchedAssetIds: [], newQuantity: 1, newStatus: 'ASSIGNED' },
  'a double-clicked truck is released once — it must not subtract two from the quantity',
)
eq(
  planUnitRelease({ ...twoUp, releaseAssetIds: ['cube99'] }),
  { mode: 'UNITS', releaseAssetIds: [], unmatchedAssetIds: ['cube99'], newQuantity: 2, newStatus: 'ASSIGNED' },
  'a truck this line is not holding is reported, NEVER widened into a line release',
)

console.log('\nplanUnitRelease — part-covered lines re-enter the assign lane')
eq(
  planUnitRelease({ quantity: 3, assignedAssetIds: ['cube10'], releaseAssetIds: ['cube10'] }),
  { mode: 'UNITS', releaseAssetIds: ['cube10'], unmatchedAssetIds: [], newQuantity: 2, newStatus: 'REQUESTED' },
  'a 3× line with one truck picked: releasing it leaves 2 pooled slots, back to REQUESTED',
)
eq(
  planUnitRelease({ quantity: 3, assignedAssetIds: ['cube10', 'cube12'], releaseAssetIds: [], pooledSlots: 1 }),
  { mode: 'UNITS', releaseAssetIds: [], unmatchedAssetIds: [], newQuantity: 2, newStatus: 'ASSIGNED' },
  'handing back the UNPICKED slot leaves both trucks and a fully-covered line',
)
eq(
  planUnitRelease({ quantity: 3, assignedAssetIds: ['cube10', 'cube12'], releaseAssetIds: ['cube10'], pooledSlots: 1 }),
  { mode: 'UNITS', releaseAssetIds: ['cube10'], unmatchedAssetIds: [], newQuantity: 1, newStatus: 'ASSIGNED' },
  'a truck AND the spare slot: 3 → 1, Cube 12 still covers it',
)
eq(
  planUnitRelease({ quantity: 2, assignedAssetIds: ['cube10', 'cube12'], releaseAssetIds: ['cube10'], pooledSlots: 1 }),
  { mode: 'ITEM', releaseAssetIds: ['cube10'], unmatchedAssetIds: [], newQuantity: 0, newStatus: 'REQUESTED' },
  'a pooled ask bigger than the line has left still lands on the whole-line release, never a negative quantity',
)

console.log('')
if (failures.length) {
  console.log(`${failures.length} FAILED`)
  process.exit(1)
}
console.log('all passed')
