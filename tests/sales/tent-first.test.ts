/**
 * Tent first, accessories next.
 *
 *   npx tsx tests/sales/tent-first.test.ts
 *   npm run test:tent-first
 *
 * Pure + offline.
 *
 * Wes 2026-09-13: "Whenever tent, Canopy, pop-up are entered. The order
 * form should offer the tent first and the accessories like side walls
 * next."
 *
 * The names below are the REAL catalog rows — the RW-imported color
 * variants and the seeded scripts/supply-catalog-seed.json rows — because
 * the failure this guards is entirely a naming collision: a sidewall is
 * called "Canopy Tent Sidewall - 10' Black" and out-matched the canopy it
 * hangs off on both of the old tiebreakers (name evidence, then shorter
 * name wins).
 *
 * Two opposite failure modes, both worth a test:
 *   TOO NARROW — rank the tents up and the 10-row dropdown has no room
 *   left for a sidewall at all. "Next" has to still be on the list.
 *   TOO BROAD — a rule that fires on any query reorders the table search
 *   too. Everything here is gated on the query naming a shelter.
 */

import {
  TENT_ACCESSORY_SLOTS,
  isTentFamilyQuery,
  orderTentFirst,
  tentRole,
  tentTier,
} from '../../src/lib/sales/tentFirst'

const failures: string[] = []

function ok(cond: boolean, why: string): void {
  if (cond) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const name = (n: string) => n
const order = (hits: string[], q: string, limit?: number) =>
  orderTentFirst(hits, q, { name, limit })

// ── The real catalog ─────────────────────────────────────────────────
const SHELTERS = [
  "Caravan Canopy - 10' x 10' Tent, Black",
  "Caravan Canopy -10' x 10', Blue",
  "Caravan Canopy - 10' x 15' Tent, White",
  "Caravan Canopy - 8' x '8 Tent, Black",
  'Caravan Canopy, 10x10',
  'Caravan Canopy, 10x20',
  'Portable Pop Up Changing Tent',
  'Pop-Up Changing Stall',
]
const ACCESSORIES = [
  "Canopy Tent Sidewall - 10' Black",
  "Canopy Tent Sidewall - 15' Blue",
  "Canopy Tent Sidewall - 8' White",
  'Sidewalls, 10x10',
  'Sidewalls, 10x15',
  'Sand Bags, 25lbs',
  '25 LB. SANDBAG',
]

// ── What counts as a tent query ──────────────────────────────────────
console.log("Wes's three words, however they're typed\n")

for (const q of ['tent', 'Tent', 'tents', 'canopy', 'Canopy', 'canopies',
                 'pop-up', 'pop up', 'popup', 'Pop-Up', 'ez up', 'ez-up',
                 '10x10 tent', 'white canopy']) {
  ok(isTentFamilyQuery(q), `"${q}" is a tent query`)
}

console.log('\nNothing else is\n')

for (const q of ['table', '6 folding table', 'walkie', 'generator', 'sidewall',
                 'sandbag', 'cube truck', '', '   ']) {
  ok(!isTentFamilyQuery(q), `"${q}" is not`)
}

console.log('\nNaming the accessory is asking for the accessory\n')

// The other direction of the same burial: a rep who typed "tent sidewall"
// has already answered the question this rule exists to answer, and
// lifting the canopies over their hit would bury it just as thoroughly.
for (const q of ['tent sidewall', 'tent wall', 'canopy sandbags', 'tent stakes',
                 'canopy weights', '10x10 tent sidewall']) {
  ok(!isTentFamilyQuery(q), `"${q}" is an accessory search`)
}

// ── Shelter vs accessory ─────────────────────────────────────────────
console.log('\nA sidewall is not a tent, whatever it is called\n')

for (const n of SHELTERS) ok(tentRole(n) === 'SHELTER', `${n} → SHELTER`)
for (const n of ACCESSORIES) ok(tentRole(n) === 'ACCESSORY', `${n} → ACCESSORY`)
ok(tentTier("Caravan Canopy, 10x10") < tentTier("Canopy Tent Sidewall - 10' Black"),
  'the canopy outranks the wall that hangs off it')
ok(tentRole('Cube Truck, 16ft') === 'OTHER', 'a truck is neither')

// ── The ordering ─────────────────────────────────────────────────────
console.log('\nTents first, accessories next\n')

{
  // Worst case, and the one that actually shipped: every accessory sorted
  // ahead of every tent.
  const got = order([...ACCESSORIES, ...SHELTERS], 'tent')
  ok(got.slice(0, SHELTERS.length).every((n) => tentRole(n) === 'SHELTER'),
    'every tent comes before every accessory')
  ok(got.slice(SHELTERS.length).every((n) => tentRole(n) === 'ACCESSORY'),
    'the accessories follow, none dropped')
  ok(got.length === SHELTERS.length + ACCESSORIES.length, 'nothing is lost')
}

{
  const got = order(["Caravan Canopy, 10x10", 'Cube Truck, 16ft', 'Sidewalls, 10x10'], 'canopy')
  ok(got[0] === 'Caravan Canopy, 10x10' && got[1] === 'Sidewalls, 10x10' && got[2] === 'Cube Truck, 16ft',
    'anything that is neither sorts last')
}

{
  // Stability: the caller's relevance order survives inside each tier, so
  // "10x10 tent" still puts the 10x10 wall ahead of the 8x8 one.
  const got = order(['Sidewalls, 10x10', 'Sidewalls, 8x8', 'Caravan Canopy, 10x10'], '10x10 tent')
  ok(got.join('|') === 'Caravan Canopy, 10x10|Sidewalls, 10x10|Sidewalls, 8x8',
    'relevance order is preserved within a tier')
}

// ── The reserve ──────────────────────────────────────────────────────
console.log('\nThe accessories survive the 10-row dropdown\n')

{
  // 30 canopies is not a hypothetical — that is what the catalog holds.
  const manyTents = Array.from({ length: 30 }, (_, i) => `Caravan Canopy, tent ${i}`)
  const got = order([...manyTents, ...ACCESSORIES], 'tent', 10)
  const acc = got.filter((n) => tentRole(n) === 'ACCESSORY')
  ok(got.length === 10, 'the list is still 10 long')
  ok(acc.length === TENT_ACCESSORY_SLOTS, `${TENT_ACCESSORY_SLOTS} slots went to accessories`)
  ok(got.slice(0, 7).every((n) => tentRole(n) === 'SHELTER'), 'the other 7 are tents')
  ok(got[7] === ACCESSORIES[0], 'the accessories start right after the tents')
}

{
  // No accessories matched → the tents get the whole list back. A reserve
  // that holds empty slots would be worse than no reserve.
  const manyTents = Array.from({ length: 30 }, (_, i) => `Caravan Canopy, tent ${i}`)
  const got = order(manyTents, 'tent', 10)
  ok(got.length === 10 && got.every((n) => tentRole(n) === 'SHELTER'),
    'no accessories on hand means no slots held back')
}

{
  const got = order(['Sidewalls, 10x10', 'Sidewalls, 8x8'], 'tent', 10)
  ok(got.length === 2, 'accessories alone are still offered')
}

// ── Everything else is untouched ─────────────────────────────────────
console.log('\nNo other search changes\n')

{
  const list = ["Table, 6' Folding", 'Sidewalls, 10x10', "Caravan Canopy, 10x10", 'Cube Truck, 16ft']
  ok(order(list, 'table').join('|') === list.join('|'), 'a table search is returned verbatim')
  ok(order(list, 'sidewall').join('|') === list.join('|'),
    'typing the ACCESSORY is not a tent query — the rep asked for walls')
  ok(order(list, 'table', 2).join('|') === list.join('|'),
    'and a non-tent query is never sliced by this rule')
}

// ── Degenerate input ─────────────────────────────────────────────────
console.log('\nDegenerate input is a pass-through, never a throw\n')

ok(order([], 'tent').length === 0, 'an empty list stays empty')
ok(order(SHELTERS, '').join('|') === SHELTERS.join('|'), 'an empty query reorders nothing')
ok(order(SHELTERS, 'tent', 0).length === 0, 'a zero limit yields nothing')

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All tent-ordering checks passed.')
