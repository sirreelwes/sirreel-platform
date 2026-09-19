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
import { holdRowId, parseHoldRowId, planUnitRelease, planRowRelease } from '../../src/lib/scheduling/holdRelease'

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

// ── BY ROW — two trips of ONE van (Wes 2026-09-19) ──────────────────────
// An asset id is not a unique key on a BookingItem. An order carries two
// date blocks of the same class as a matter of routine, so the same van
// sits on the hold TWICE; the asset path dedupes its list and its write is
// an `updateMany` on `assetId IN (…)`, so removing ONE line took the
// sibling line's trip with it and left the hold reading "0 of 1 assigned"
// over two SWAPPED rows — with a live line still quoting the van.
eq(
  planRowRelease({
    quantity: 2,
    activeAssignmentIds: ['a-sep17', 'a-sep20'],
    releaseAssignmentIds: ['a-sep20'],
  }),
  { mode: 'UNITS', releaseAssignmentIds: ['a-sep20'], unmatchedAssignmentIds: [], newQuantity: 1, newStatus: 'ASSIGNED' },
  'releasing ONE trip of a van that is on the hold twice leaves the other trip bound',
)
// The trap the floor exists for: the quantity is the PEAK, so two
// NON-overlapping trips of one van are quantity 1 with two rows. Without
// the floor this reaches 0, degrades to the whole-item release, and swaps
// the trip that was staying — the exact bug, by a different door.
eq(
  planRowRelease({
    quantity: 1,
    activeAssignmentIds: ['a-sep17', 'a-sep24'],
    releaseAssignmentIds: ['a-sep24'],
  }),
  { mode: 'UNITS', releaseAssignmentIds: ['a-sep24'], unmatchedAssignmentIds: [], newQuantity: 1, newStatus: 'ASSIGNED' },
  'a peak-quantity hold never degrades to the whole line while a truck is still bound',
)
eq(
  planRowRelease({
    quantity: 1,
    activeAssignmentIds: ['a-sep17'],
    releaseAssignmentIds: ['a-sep17'],
  }),
  { mode: 'ITEM', releaseAssignmentIds: ['a-sep17'], unmatchedAssignmentIds: [], newQuantity: 0, newStatus: 'REQUESTED' },
  'the last truck off a one-truck line is still the whole-line release',
)
eq(
  planRowRelease({
    quantity: 3,
    activeAssignmentIds: ['a1', 'a2'],
    releaseAssignmentIds: ['a1'],
    pooledSlots: 1,
  }),
  { mode: 'UNITS', releaseAssignmentIds: ['a1'], unmatchedAssignmentIds: [], newQuantity: 1, newStatus: 'ASSIGNED' },
  'a row and a spare slot: 3 -> 1, the other truck still covers it',
)
eq(
  planRowRelease({
    quantity: 2,
    activeAssignmentIds: ['a1', 'a2'],
    releaseAssignmentIds: ['gone'],
  }),
  { mode: 'UNITS', releaseAssignmentIds: [], unmatchedAssignmentIds: ['gone'], newQuantity: 2, newStatus: 'ASSIGNED' },
  'a row this line no longer holds is reported, never widened into a release',
)
eq(
  planRowRelease({
    quantity: 2,
    activeAssignmentIds: ['a1', 'a2'],
    releaseAssignmentIds: ['a1', 'a1'],
  }),
  { mode: 'UNITS', releaseAssignmentIds: ['a1'], unmatchedAssignmentIds: [], newQuantity: 1, newStatus: 'ASSIGNED' },
  'a double-click naming one ROW twice still subtracts one',
)
// The asset path is UNCHANGED, and this is the state Wes photographed.
// Two Sprinter 2 rows on one hold of quantity 2: the plan dedupes to one
// asset, so the quantity comes down by ONE to 1 — and the write behind it
// (`updateMany` on assetId) then swaps BOTH rows. Hold left reading
// "0 of 1 assigned" over two SWAPPED rows, with the line still quoting the
// van. The arithmetic is not what is wrong here; addressing a ROW by its
// asset is, which is why the line path releases rows instead.
eq(
  planUnitRelease({ quantity: 2, assignedAssetIds: ['sprinter2', 'sprinter2'], releaseAssetIds: ['sprinter2'] }),
  { mode: 'UNITS', releaseAssetIds: ['sprinter2'], unmatchedAssetIds: [], newQuantity: 1, newStatus: 'REQUESTED' },
  'by ASSET, one van on the hold twice deducts one and sheds two — the screenshot, and why the line path stopped using it',
)

console.log('')
if (failures.length) {
  console.log(`${failures.length} FAILED`)
  process.exit(1)
}
console.log('all passed')
