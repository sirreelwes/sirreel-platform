/**
 * Guards a vehicle's daily rate against going stale on ONE surface.
 *
 * Wes, 2026-09-13: "cargo vans with liftgates are 170 per day and it
 * should always reflect that." The rates in Fleet Pricing were already
 * right ($150 without a liftgate, $170 with) — the failure was that most
 * owned VehicleCategory rows carry a NULL dailyRate of their OWN and get
 * their price entirely from the linked Fleet Pricing row, so any surface
 * that read the column alone silently reported $0 / price-on-quote.
 *
 * /api/public/supply-request did exactly that: the client's cart showed
 * $170/day and the Inquiry the agent read back recorded nothing. Three
 * surfaces price the same vehicle, so all three have to resolve it the
 * same way — which means CALLING pickEffectiveDailyRate, not re-deriving
 * the rule. This test checks both halves: the rule itself, and that the
 * routes actually go through it.
 *
 *   npm run test:vehicle-rate
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pickEffectiveDailyRate } from '@/lib/pricing/resolveRate'

let fail = 0
function ok(label: string, cond: boolean, detail = '') {
  if (!cond) fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

// ── The rule ──────────────────────────────────────────────────────
// Shapes as the live rows actually are (measured 2026-09-13): both cargo
// vans price from Fleet Pricing with a null column of their own.
const cargoVan = { dailyRate: null, catalogItem: { dailyRate: 150 }, assetCategory: { dailyRate: 150 } }
const cargoVanLiftgate = { dailyRate: null, catalogItem: { dailyRate: 170 }, assetCategory: { dailyRate: 170 } }

console.log('— the rate a client is quoted —')
ok('Cargo Van w/o liftgate → 150', pickEffectiveDailyRate(cargoVan) === 150)
ok('Cargo Van w/ liftgate → 170', pickEffectiveDailyRate(cargoVanLiftgate) === 170)
ok(
  'the liftgate van is never priced as the plain one',
  pickEffectiveDailyRate(cargoVanLiftgate) !== pickEffectiveDailyRate(cargoVan),
)

console.log('\n— precedence —')
ok(
  'Fleet Pricing beats the row fallback',
  pickEffectiveDailyRate({ dailyRate: 150, catalogItem: { dailyRate: 170 } }) === 170,
)
ok(
  'a null Fleet Pricing rate falls back to the row',
  pickEffectiveDailyRate({ dailyRate: 170, catalogItem: { dailyRate: null } }) === 170,
)
ok(
  'no link at all falls back to the row',
  pickEffectiveDailyRate({ dailyRate: 170, catalogItem: null }) === 170,
)
ok(
  'nothing set anywhere is genuinely price-on-quote',
  pickEffectiveDailyRate({ dailyRate: null, catalogItem: { dailyRate: null } }) === null,
)
// The specific regression: a row that prices ONLY from Fleet Pricing must
// never read as price-on-quote just because its own column is null.
ok(
  'a Fleet-Pricing-only row is not price-on-quote',
  pickEffectiveDailyRate({ dailyRate: null, catalogItem: { dailyRate: 170 } }) === 170,
)

// ── The surfaces ──────────────────────────────────────────────────
// A pure-function test can't catch the bug that actually shipped: the
// helper was right, the route just never called it. So check the source
// of every surface that prices a vehicle for a client.
console.log('\n— every surface that prices a vehicle goes through the rule —')
const ROOT = join(__dirname, '..', '..')
const SURFACES = [
  ['public supply-request (what the agent reads back)', 'src/app/api/public/supply-request/route.ts'],
  ['public vehicle-categories (the order form)', 'src/app/api/public/vehicle-categories/route.ts'],
  ['public vehicle catalog (/vehicles + site search)', 'src/lib/site/vehicleCatalog.ts'],
] as const

for (const [label, rel] of SURFACES) {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  ok(`${label} calls pickEffectiveDailyRate`, src.includes('pickEffectiveDailyRate('))
  // Selecting the column without the link is the shape of the bug.
  const selectsColumn = /dailyRate:\s*true/.test(src)
  ok(
    `${label} selects catalogItem alongside dailyRate`,
    !selectsColumn || /catalogItem:\s*\{[^}]*dailyRate/.test(src),
  )
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall passed')
process.exit(fail ? 1 : 0)
