/**
 * Lines the warehouse cannot pull from — src/lib/orders/pullAmbiguity.ts.
 *
 * The case is real: order S260904-002 ("Lunch Rush") carries
 * "2 × 10' x 10' Pop-Ups with Sides" booked against the catalog row
 * *Sidewalls, 10x10*. Nothing on that order says how many walls, and the
 * tents are on no list at all.
 *
 * Run: npm run test:pull-ambiguity
 */
import { pullGapsForLine, pullGapsForOrder } from '@/lib/orders/pullAmbiguity'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const kinds = (l: Parameters<typeof pullGapsForLine>[0], sib: Parameters<typeof pullGapsForLine>[1] = []) =>
  pullGapsForLine(l, sib).map((g) => g.kind)

// ── The line Wes sent ────────────────────────────────────────────────
const lunchRush = { description: "10' x 10' Pop-Ups with Sides", quantity: 2, catalogName: 'Sidewalls, 10x10' }
eq('the real line flags both faults', kinds(lunchRush, [lunchRush]), ['BUNDLED_SIDES', 'MISCATALOGUED'])
console.log(`     ${pullGapsForLine(lunchRush, [lunchRush]).map((g) => g.message).join('\n     ')}`)
eq(
  'and it says how many walls that is',
  /8 walls/.test(pullGapsForLine(lunchRush, [lunchRush])[0].message),
  true,
)

// ── Itemised orders are silent ───────────────────────────────────────
{
  const tent = { description: 'Pop-Up Tent 10x10 with sides', quantity: 4, catalogName: 'Caravan Canopy, 10x10' }
  const walls = { description: 'Sidewalls, 10x10', quantity: 16, catalogName: 'Sidewalls, 10x10' }
  eq('sides on their own line answer the question', kinds(tent, [tent, walls]), [])
}
eq(
  'a count in the description answers it too',
  kinds({ description: '10x10 pop-up with 4 sides', quantity: 1, catalogName: 'Caravan Canopy, 10x10' }),
  [],
)
eq(
  'a plain tent promises nothing',
  kinds({ description: "Caravan Canopy Tent -10' x 10', Black", quantity: 4, catalogName: "Caravan Canopy Tent -10' x 10', Black" }),
  [],
)
eq(
  'a plain sidewall line is not a bundle',
  kinds({ description: 'Sidewalls, 10x10', quantity: 16, catalogName: 'Sidewalls, 10x10' }),
  [],
)
eq('nothing tent-shaped is left alone', kinds({ description: 'Motorola CP200 Battery', quantity: 8, catalogName: 'Motorola CP200 Battery' }), [])
eq(
  'an unbound line is judged on its words alone',
  kinds({ description: 'Pop ups with sidewalls', quantity: 3, catalogName: null }),
  ['BUNDLED_SIDES'],
)

// ── The other direction ──────────────────────────────────────────────
eq(
  'an accessory booked against a tent',
  kinds({ description: 'Tent sidewalls', quantity: 8, catalogName: 'Caravan Canopy, 10x10' }),
  ['MISCATALOGUED'],
)

// ── The whole order ──────────────────────────────────────────────────
{
  const lines = [
    { description: 'ProScout / VideoVan', quantity: 1, catalogName: 'ProScout / VideoVan' },
    lunchRush,
    { description: 'Tall Director Chairs', quantity: 3, catalogName: "Director's Chairs, Tall" },
  ]
  eq('only the bad line is flagged', [...pullGapsForOrder(lines).keys()], [1])
}

console.log(fail === 0 ? '\nall pull-ambiguity checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
