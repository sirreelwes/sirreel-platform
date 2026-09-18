/**
 * "Is there enough?" — the arithmetic behind the stock number that
 * renders beside every line's quantity.
 *
 *   npx tsx tests/inventory/stock.test.ts
 *   npm run test:stock
 *
 * Pure math, no DB. Two things are guarded here because either one,
 * wrong, tells an agent there is gear on the shelf that isn't:
 *
 *   · summariseDemand — which other orders count against an item over a
 *     window (inclusive overlap, per-line date overrides, sub-rentals
 *     that move the line off our shelf, quotes vs. firm orders).
 *   · stockVerdict — what the UI shows, including the two deliberate
 *     SILENCES: a unit-tracked row, and an item nobody has counted.
 *     The second matters most: 0 in qtyOwned means "never counted" for
 *     a quarter of the catalog-bound lines in the book, and rendering
 *     those red would train the crew to ignore the color.
 */

import {
  summariseDemand,
  stockVerdict,
  type DemandLine,
  type ItemStock,
} from '../../src/lib/inventory/stock'

const failures: string[] = []

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message)
  else console.log(`  ok — ${message}`)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message} (got ${String(actual)}, want ${String(expected)})`)
}

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const WINDOW = { start: d('2026-09-14'), end: d('2026-09-18') }
const STRAPS = 'straps'

function line(over: Partial<DemandLine> = {}): DemandLine {
  return {
    inventoryItemId: STRAPS,
    quantity: 10,
    pickupDate: d('2026-09-14'),
    returnDate: d('2026-09-18'),
    startDate: null,
    endDate: null,
    orderStatus: 'BOOKED',
    subRentalQuantities: [],
    ...over,
  }
}

const committedOf = (lines: DemandLine[]) => summariseDemand(lines, WINDOW).committed.get(STRAPS) ?? 0
const quotedOf = (lines: DemandLine[]) => summariseDemand(lines, WINDOW).quoted.get(STRAPS) ?? 0

console.log('\nOverlap is inclusive on both ends')
eq(committedOf([line()]), 10, 'a line on exactly this window counts')
eq(
  committedOf([line({ pickupDate: d('2026-09-10'), returnDate: d('2026-09-14') })]),
  10,
  'returning the day the window opens still has the gear out that morning',
)
eq(
  committedOf([line({ pickupDate: d('2026-09-18'), returnDate: d('2026-09-25') })]),
  10,
  'going out the day the window closes counts',
)
eq(
  committedOf([line({ pickupDate: d('2026-09-10'), returnDate: d('2026-09-13') })]),
  0,
  'back the day before the window opens does not count',
)
eq(
  committedOf([line({ pickupDate: d('2026-09-19'), returnDate: d('2026-09-25') })]),
  0,
  'leaving the day after the window closes does not count',
)
eq(
  committedOf([line({ pickupDate: d('2026-09-01'), returnDate: d('2026-10-01') })]),
  10,
  'a line that swallows the whole window counts',
)

console.log('\nPer-line dates override the order window')
eq(
  committedOf([
    line({
      pickupDate: d('2026-09-14'),
      returnDate: d('2026-09-18'),
      startDate: d('2026-09-25'),
      endDate: d('2026-09-30'),
    }),
  ]),
  0,
  'a line moved off the order window is measured where it actually sits',
)
eq(
  committedOf([
    line({
      pickupDate: d('2026-10-01'),
      returnDate: d('2026-10-05'),
      startDate: d('2026-09-15'),
      endDate: d('2026-09-16'),
    }),
  ]),
  10,
  'an override that lands INSIDE the window counts, even though the order sits outside',
)

console.log('\nSub-rentals take the line off our shelf')
eq(
  committedOf([line({ quantity: 8, subRentalQuantities: [8] })]),
  0,
  'fully sub-rented demands nothing from us',
)
eq(
  committedOf([line({ quantity: 8, subRentalQuantities: [5] })]),
  3,
  'partially sub-rented releases the covered part back',
)
eq(
  committedOf([line({ quantity: 8, subRentalQuantities: [3, 2] })]),
  3,
  'two sub-rentals on one line both count',
)
eq(
  committedOf([line({ quantity: 8, subRentalQuantities: [12] })]),
  0,
  'over-covering never turns into negative demand',
)

console.log('\nFirm orders claim the shelf; quotes only apply pressure')
for (const status of ['APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB'] as const) {
  eq(committedOf([line({ orderStatus: status })]), 10, `${status} is committed`)
}
for (const status of ['DRAFT', 'QUOTE_SENT'] as const) {
  eq(committedOf([line({ orderStatus: status })]), 0, `${status} is not committed`)
  eq(quotedOf([line({ orderStatus: status })]), 10, `${status} shows as quoted pressure`)
}

console.log('\nLines add up, and other items stay out of it')
eq(
  committedOf([line({ quantity: 4 }), line({ quantity: 6 }), line({ quantity: 5, orderStatus: 'DRAFT' })]),
  10,
  'two firm lines sum; the draft stays in its own bucket',
)
eq(
  committedOf([line({ inventoryItemId: 'cones' }), line({ quantity: 3 })]),
  3,
  'another item on the same order does not consume these',
)
eq(
  committedOf([line({ inventoryItemId: null, quantity: 99 })]),
  0,
  'a custom (uncatalogued) line consumes nothing — we cannot know what it is',
)

/* ── The verdict the agent actually sees ─────────────────────────── */

function stock(over: Partial<ItemStock> = {}): ItemStock {
  return {
    inventoryItemId: STRAPS,
    mode: 'QUANTITY',
    onHand: 24,
    counted: true,
    committed: 4,
    quoted: 0,
    available: 20,
    ...over,
  }
}

console.log('\nThe number goes red only when the line passes it')
const at20 = stockVerdict(stock(), 20)
check(at20.show && !at20.over, 'asking for exactly what is free is NOT a shortfall')
const at21 = stockVerdict(stock(), 21)
check(at21.show && at21.over && at21.short === 1, 'one past free is short by one')
const at40 = stockVerdict(stock(), 40)
check(at40.show && at40.short === 20, 'twenty past free is short by twenty')

console.log('\nOther lines of the same order are netted here')
const sibling = stockVerdict(stock(), 15, 10)
check(
  sibling.show && sibling.available === 10 && sibling.over,
  'a sibling line asking 10 leaves 10 free — so 15 on this line is short',
)
const oversold = stockVerdict(stock({ committed: 30, available: -6 }), 1)
check(oversold.show && oversold.available === -6 && oversold.over, 'already oversold reads negative and stays red')

console.log('\nSilences — a wrong red is worse than no number')
check(stockVerdict(null, 5).show === false, 'no stock row yet (still loading) shows nothing')
check(
  stockVerdict(stock({ mode: 'UNIT_TRACKED', counted: false }), 5).show === false,
  'a vehicle/stage row shows nothing — the scheduler owns that answer',
)
check(
  stockVerdict(stock({ onHand: 0, counted: false, available: 0 }), 5).show === false,
  'an item nobody has counted shows nothing, NOT a red zero',
)
check(
  stockVerdict(stock({ onHand: 1, counted: true, committed: 0, available: 1 }), 5).over === true,
  'but an item counted at 1 does flag a request for 5',
)

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`)
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('\nAll stock checks passed.\n')
