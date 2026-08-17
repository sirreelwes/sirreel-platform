/**
 * Catalog fallback-matcher tests — the server-side pass that resolves a
 * quote line's free-text description to a catalog row when the AI declined
 * to (added 2026-08-17 after an AI-parsed quote priced "6' folding tables"
 * off the 6'/8' coin flip and "garment racks" off the Air Conditioner).
 *
 *   npx tsx tests/sales/catalog-match.test.ts
 *   npm run test:catalog-match
 *
 * DB-backed and READ-ONLY — it asserts against live catalog rows, so a
 * failure here can also mean someone renamed or deactivated an item rather
 * than that the matcher regressed. Env loads before the prisma-touching
 * import, same as tests/scheduling.
 */

import { readFileSync } from 'fs'
import path from 'path'

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const failures: string[] = []

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message)
  else console.log(`  ok — ${message}`)
}

/**
 * null expectation = "must decline", i.e. the UI shows the amber picker.
 *
 * Not covered here, deliberately: a bare generic noun we stock N variants of
 * ("carts", "hangers", "fans", "generator") still resolves to one of them by
 * the deterministic tiebreak rather than declining. That predates this work
 * and is what makes a bare "walkies" resolve at all — changing it is a call
 * for Wes, not a bug in the scoring.
 */
const CASES: Array<[description: string, expected: string | null]> = [
  // Spec gate — the size/capacity IS the item. A wrong pick here bills the
  // client at another item's rate and nothing in the UI flags it.
  ["6' folding tables", 'Table, 6\' Folding'],
  ["8' folding table", 'Table, 8\' Folding'],
  ["4' folding tables", 'Table, 4\' Folding'],
  ['6ft tables', 'Table, 6\' Folding'],
  ['6-foot folding tables', 'Table, 6\' Folding'],
  ['100 qt cooler', 'Cooler, 100 qt'],
  ['68 qt cooler', 'Cooler, 68 qt'],
  ['3000w generator', 'Generator, 3000W'],
  ["25' extension cords", "Ext. Cord, 25'"],
  ["50' stingers", "Ext. Cord, 50'"],

  // Aliases match on word boundaries, not as substrings: the two-letter
  // "ac" on Air Conditioner used to fire inside "garment ra{ck}s".
  ['garment rack', 'Wardrobe Rack, Rolling'],

  // Evidence floor — one shared generic token ("cart", "kit", "rack") is
  // not a match. Declining sends the rep to the picker; guessing sends a
  // $134 head cart out on a quote that asked for a $20 utility cart.
  ['Basic cleaning kit', null],

  // …and where the vocabulary gap is real — SirReel says "Wardrobe Rack",
  // the crew says "garment rack" — the translation lives in the row's
  // aliases (scripts/seed-catalog-aliases.ts), not in the scoring.
  ['garment racks + hangers', 'Wardrobe Rack, Rolling'],
  ['clothing racks', 'Wardrobe Rack, Rolling'],
  ['rolling utility / production carts', 'Rubbermaid Cart'],
  ['utility cart', 'Rubbermaid Cart'],
  ['trash can liners', 'Trash Liners, Roll'],
  ['trash bags', 'Trash Liners, Roll'],
  ['garbage bags', 'Trash Liners, Roll'],
  // …without stranding the disposal service, whose own name contains the
  // phrase now owned by the liners.
  ['trash bag disposal', 'Trash Bag Disposal'],
  // The seeded aliases must not swallow their neighbours.
  ['z-rack', 'RollingWardrobe Z-Rack'],
  ["director's chair cart", "Director's Chair Cart, Rolling"],

  // …but a row that explains most of the description wins on a narrow lead.
  ['large trash cans + liners', 'Trash Cans, Large'],
  ['first aid kit', 'First Aid Kit "50 Person"'],
  ['First-aid kit', 'First Aid Kit "50 Person"'],

  // Name tokens are deduped — 'Fan, "RE Fan" w/stand' outscored the plain
  // utility fan on "fans" purely by saying "fan" twice.
  ['utility fans', 'Fan, "Utility"'],

  // Unchanged behavior — the curated-alias path and its deterministic
  // tiebreak among identically-scoring variants.
  // Walkies default to digital (Wes, 8/17); the analog answers only when
  // the request says so. Same rate either way — this is a pull-sheet
  // question, not a billing one.
  ['walkies', 'Motorola CP200d  UHF Radio (Digital)'],
  ['walkie talkies', 'Motorola CP200d  UHF Radio (Digital)'],
  ['handhelds', 'Motorola CP200d  UHF Radio (Digital)'],
  ['analog walkies', 'Motorola CP200  UHF Radio (Analog)'],
  ['cp200 analog', 'Motorola CP200  UHF Radio (Analog)'],
  ['surveillance kits', 'Surveillance Kit'],
  ['hand mics', 'Hand Mics'],
  ['sandbags', '25 LB. SANDBAG'],
  ['cube truck', 'SuperCube Truck'],
  ['liftgate van', 'Cargo Van w/ Liftgate'],
  ['folding chairs', 'Chairs, Folding'],
  ["6' wardrobe mirror", "Mirror, 6' Wardrobe"],
]

async function main(): Promise<void> {
  const { fallbackMatch, extractSpecs } = await import('../../src/lib/sales/catalogMatcher')

  console.log('\nextractSpecs')
  const specs = (s: string): string => [...extractSpecs(s)].sort().join(',')
  check(specs("6' folding tables") === '6ft', "6' → 6ft")
  check(specs('6-foot table') === '6ft', '6-foot → 6ft')
  check(specs('6ft table') === '6ft', '6ft → 6ft')
  check(specs('30" cocktail') === '30in', '30" → 30in')
  check(specs('100 qt cooler') === '100qt', '100 qt → 100qt')
  check(specs('7000 watt generator') === '7000w', '7000 watt → 7000w')
  check(specs('1.5-ton a/c') === '1.5ton', '1.5-ton → 1.5ton')
  check(specs('2K fresnel') === '2k', '2K → 2k')
  check(specs('walkies') === '', 'no spec in a plain description')
  check(specs('2 A-Frame ladders') === '', 'bare "A" is not read as amps')

  console.log('\nfallbackMatch')
  for (const [desc, expected] of CASES) {
    const got = await fallbackMatch(desc)
    const gotName = got ? got.name : null
    check(
      gotName === expected,
      `${JSON.stringify(desc)} → ${expected === null ? 'no match' : expected}` +
        (gotName === expected ? '' : `  [got: ${gotName ?? 'no match'}]`)
    )
  }

  console.log('')
  if (failures.length > 0) {
    console.error(`${failures.length} failure(s):`)
    for (const f of failures) console.error(`  FAIL — ${f}`)
    process.exit(1)
  }
  console.log('all catalog-match tests passed')
  process.exit(0)
}

main()
