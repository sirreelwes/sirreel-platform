/**
 * Furniture + dolly → Pro Supplies — the match rules, held to the REAL
 * catalog names.
 *
 *   npx tsx tests/inventory/furniture-dolly-class.test.ts
 *   npm run test:furniture-dolly
 *
 * Pure strings, no DB. Every name below is (or was) an actual row in the
 * catalog — taken from exports/catalog-export.json and the RW import
 * plans in docs/cleanup/ — because the sweep this drives moves items
 * between departments, and a department move is a PRICE move (GE bills 7
 * days a week, Pro Supplies 3). The cases that matter are the ones where
 * a plain "does it say dolly" would get it wrong: a rack, a cart that
 * isn't a dolly, and the two names that read as both clusters at once.
 */

import { classifyFurnitureDolly } from '../../src/lib/inventory/furnitureDollyClass'

const failures: string[] = []

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message)
  else console.log(`  ok — ${message}`)
}

function movesTo(name: string, cluster: 'dollies' | 'furniture', why: string): void {
  const v = classifyFurnitureDolly(name)
  check(
    v?.kind === 'move' && v.cluster.key === cluster,
    `${why} — "${name}" → ${cluster} (got ${v === null ? 'no match' : v.kind === 'skip' ? `skip: ${v.reason}` : v.cluster.key})`,
  )
}

function skips(name: string, why: string): void {
  const v = classifyFurnitureDolly(name)
  check(v?.kind === 'skip', `${why} — "${name}" is skipped (got ${v === null ? 'no match' : v.kind})`)
}

function untouched(name: string, why: string): void {
  const v = classifyFurnitureDolly(name)
  check(v === null, `${why} — "${name}" is not in scope (got ${v?.kind ?? 'null'})`)
}

console.log('\nDollies — the whole family rolls into Dollies & Carts')
movesTo('Dolly, Magliner Sr. w/Shelf', 'dollies', 'the curated basecamp dollies')
movesTo('Dolly - Magliner Jr', 'dollies', 'and their RW-imported twins')
movesTo('Dolly, Handtruck (2-Wheel)', 'dollies', 'hand trucks count')
movesTo('Dolly- Appliance "Refrigerator"', 'dollies', 'appliance dollies count')
movesTo('Pallet Jack', 'dollies', 'a pallet jack never says "dolly" and still belongs')
movesTo('Go Jacks -Car Dolly', 'dollies', 'car dollies count')

console.log('\nDollies a grip would call their own — Wes: "even the ones a grip uses"')
movesTo('DOORWAY DOLLY (SKATE)', 'dollies', 'doorway dolly leaves G&E')
movesTo('WESTERN DOLLY', 'dollies', 'western dolly leaves G&E')
movesTo('DANA DOLLY', 'dollies', 'Dana dolly leaves G&E')
movesTo("10' DOLLY TRACK SECTION (STEEL)", 'dollies', 'the track goes with the dollies')
movesTo('DOORWAY DOLLY TRACK WHEELS (4 PER SET)', 'dollies', 'so do the track wheels')

console.log('\nBoth clusters at once — dolly wins, it is a dolly')
movesTo('Dolly, Furniture', 'dollies', 'a furniture dolly is a dolly')
movesTo('Dolly - Furniture (4 Wheel)', 'dollies', 'the RW twin too')
movesTo('Dolly- Furniture (4W)- HD (19" x 32"), 1000lbs', 'dollies', 'and the heavy-duty one')

console.log('\nFurniture → Basecamp Basics')
movesTo('Furniture Pads', 'furniture', 'pads are the obvious case')
movesTo('UTAH - FURNITURE PADS', 'furniture', 'the Utah variant reads the same')
movesTo('12ﬂ FURNITURE CLAMP', 'furniture', 'clamps move too — Wes said all furniture gear')
movesTo('BABY SLIDER FOR FURNITURE CLAMP', 'furniture', 'and the slider that rides with the clamp')

console.log('\nRacks carry the gear, they are not the gear')
skips('Dolly Track Rack, Single', 'a truck rack stays in Vehicle Outfitting')

console.log('\nOut of scope entirely')
untouched('DollyTrack Racks (Each)', 'no word break after "Dolly", and a rack besides')
untouched('Rubbermaid Cart', 'a bare cart is not a dolly rule — it is already Pro Supplies')
untouched('LIGHTING CART', 'and a lighting cart stays G&E')
untouched("Director's Chair Rack, Rolling", 'chairs and their racks are a different question')
untouched('C-Stand 40"', 'ordinary grip is untouched')
untouched('Steel Deck, 4x8', 'steel deck is untouched')

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nAll furniture/dolly classification checks passed.\n')
