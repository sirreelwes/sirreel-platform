/**
 * Sandbags with every tent.
 *
 *   npx tsx tests/sales/tent-sandbags.test.ts
 *   npm run test:tent-sandbags
 *
 * Pure + offline.
 *
 * Wes 2026-09-13: four sandbags per 10x10, six per 10x15, eight per
 * 10x20. Those three numbers are the contract and are asserted literally
 * below — if a refactor changes one, this test is the thing that says so.
 *
 * Every tent name here is a REAL catalog row, because the risk is
 * entirely in the spelling: the catalog writes the same footprint six
 * ways ("10' x 15'", "10x15", "-10' x 10'", "10' x 20," and the two
 * typo'd rows "8' x '8"), and a size the parser cannot read means a tent
 * that silently ships with no ballast offered.
 *
 * The opposite failure matters just as much: "Sidewalls, 10x15" carries a
 * footprint and must NOT get its own sandbags — it hangs off a tent that
 * already has them.
 */

import {
  SANDBAGS_BY_SIZE,
  isSandbagItem,
  sandbagOffer,
  sandbagsPerTent,
  tentFootprint,
} from '../../src/lib/sales/tentSandbags'

const failures: string[] = []
function ok(cond: boolean, why: string): void {
  if (cond) console.log(`  ok — ${why}`)
  else failures.push(why)
}

// ── Wes's numbers ────────────────────────────────────────────────────
console.log("Wes's counts, stated literally\n")

ok(SANDBAGS_BY_SIZE['10x10'] === 4, 'four sandbags per 10 x 10 tent')
ok(SANDBAGS_BY_SIZE['10x15'] === 6, 'six sandbags per 10 x 15 tent')
ok(SANDBAGS_BY_SIZE['10x20'] === 8, 'eight sandbags per 10 x 20 tent')
// Not stated by Wes — an 8x8 stands on the same four legs as a 10x10.
ok(SANDBAGS_BY_SIZE['8x8'] === 4, 'four for an 8 x 8 (assumed: same four legs)')

// ── Every spelling in the catalog ────────────────────────────────────
console.log('\nEvery real tent row reads its own footprint\n')

const TENTS: Array<[string, number]> = [
  ["Caravan Canopy - 10' x 10' Tent, Black", 4],
  ["Caravan Canopy - 10' x 10' Tent, White", 4],
  ["Caravan Canopy -10' x 10', Black", 4],
  ["Caravan Canopy -10' x 10', Blue", 4],
  ['Caravan Canopy, 10x10', 4],
  ["Caravan Canopy - 10' x 15' Tent, Grey", 6],
  ["Caravan Canopy - 10' x 15', Blue", 6],
  ['Caravan Canopy, 10x15', 6],
  ["Caravan Canopy - 10' x 20' Tent, Blue", 8],
  ["Caravan Canopy - 10' x 20', Black", 8],
  // The comma-for-apostrophe typo, exactly as the catalog holds it.
  ["Caravan Canopy - 10' x 20, Blue", 8],
  ['Caravan Canopy, 10x20', 8],
  ["Caravan Canopy - 8' x 8', White", 4],
  // The transposed feet mark, exactly as the catalog holds it.
  ["Caravan Canopy - 8' x '8 Tent, Black", 4],
  ["Caravan Canopy - 8' x '8 Tent, White", 4],
]

for (const [n, want] of TENTS) {
  ok(sandbagsPerTent(n) === want, `${n} → ${want}`)
}
ok(TENTS.length === 15, 'all 15 sized tent rows are covered')

// ── The accessories get none of their own ────────────────────────────
console.log('\nAn accessory is not a tent\n')

for (const n of ['Sidewalls, 10x10', 'Sidewalls, 10x15', 'Sidewalls, 8x8']) {
  ok(tentFootprint(n) !== null, `${n} does carry a footprint...`)
  ok(sandbagsPerTent(n) === null, `...but ${n} is offered no sandbags of its own`)
}
for (const n of ["Canopy Tent Sidewall - 10' Black", "Canopy Tent Sidewall - 15' Blue"]) {
  ok(sandbagsPerTent(n) === null, `${n} → none`)
}
ok(sandbagsPerTent('Sand Bags, 25lbs') === null, 'sandbags do not offer themselves sandbags')

// ── Sized-tent-only ──────────────────────────────────────────────────
console.log('\nA tent with no footprint offers nothing, rather than a guess\n')

ok(sandbagsPerTent('Portable Pop Up Changing Tent') === null, 'a changing tent has no footprint')
ok(sandbagsPerTent('Pop-Up Changing Stall') === null, 'nor a changing stall')
ok(sandbagsPerTent("Caravan Canopy - 20' x 20' Tent") === null,
  'an unlisted size stays silent — a rep who sees no offer asks; a wrong count ships')
ok(sandbagsPerTent('Cube Truck, 16ft') === null, 'a truck is not a tent')
ok(sandbagsPerTent("Table, 6' Folding") === null, 'neither is a table')

// ── Footprint normalization ──────────────────────────────────────────
console.log('\nOne footprint however it is written\n')

ok(tentFootprint("10' x 15'") === '10x15', "10' x 15' → 10x15")
ok(tentFootprint('10x15') === '10x15', '10x15 → 10x15')
ok(tentFootprint("15' x 10'") === '10x15', 'the long side second, always')
ok(tentFootprint('no size here') === null, 'no pair, no footprint')

// ── The quantity ─────────────────────────────────────────────────────
console.log('\nThe offer follows the tent quantity\n')

{
  const one = sandbagOffer('Caravan Canopy, 10x20', 1)
  ok(one?.perTent === 8 && one?.total === 8, 'one 10x20 → 8 bags')
  const three = sandbagOffer('Caravan Canopy, 10x20', 3)
  ok(three?.perTent === 8 && three?.total === 24, 'three 10x20s → 24 bags')
  ok(three?.size === '10x20', 'the offer names the footprint it read')
  const two = sandbagOffer('Caravan Canopy, 10x15', 2)
  ok(two?.total === 12, 'two 10x15s → 12 bags')
  ok(sandbagOffer('Sidewalls, 10x15', 4) === null, 'no offer on an accessory line')
}

console.log('\nDegenerate quantities are a floor of one tent, never a throw\n')

ok(sandbagOffer('Caravan Canopy, 10x10', 0)?.total === 4, 'a zero quantity still reads as one tent')
ok(sandbagOffer('Caravan Canopy, 10x10', -5)?.total === 4, 'so does a negative')
ok(sandbagOffer('Caravan Canopy, 10x10', 2.7)?.total === 8, 'a fractional quantity floors')
ok(sandbagOffer('Caravan Canopy, 10x10', NaN)?.total === 4, 'NaN reads as one tent')

// ── Resolving the sandbag row ────────────────────────────────────────
console.log('\nBoth spellings of a sandbag are recognised\n')

ok(isSandbagItem('Sand Bags, 25lbs'), '"Sand Bags, 25lbs" (tents & accessories)')
ok(isSandbagItem('Sand Bags, 35lbs'), '"Sand Bags, 35lbs"')
ok(isSandbagItem('25 LB. SANDBAG'), '"25 LB. SANDBAG" (the older grip row)')
ok(!isSandbagItem('Caravan Canopy, 10x10'), 'a canopy is not a sandbag')
ok(!isSandbagItem('Sidewalls, 10x10'), 'nor a sidewall')

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All tent-sandbag checks passed.')
