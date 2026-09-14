/**
 * The warehouse kit checklists.
 *
 *   npx tsx tests/warehouse/kit-checklists.test.ts
 *   npm run test:kit-checklists
 *
 * Pure + offline.
 *
 * This guards a TABLE, so it guards the things a table gets wrong: a
 * package seeded onto no rows, the same catalog row claimed by two
 * packages, a part listed twice under one parent, and — the one that
 * matters most — a check whose spelling drifts from what Oliver wrote on
 * the shelf.
 *
 * The parts are asserted VERBATIM because the whole point is a picker
 * reading the sheet and recognising the words. "9420 Power Cable" is not
 * interchangeable with "Power cable (9420)" to someone holding a box.
 */

import {
  KIT_CHECKLISTS,
  allChecklistCodes,
  checklistForCode,
} from '../../src/lib/warehouse/kitChecklists'
import { normalizeUnitChecks } from '../../src/lib/warehouse/unitScanRules'

const failures: string[] = []
function ok(cond: boolean, why: string): void {
  if (cond) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const find = (label: string) => {
  const c = KIT_CHECKLISTS.find((x) => x.label.includes(label))
  if (!c) throw new Error(`no checklist matching "${label}"`)
  return c
}

// ── Oliver's list, verbatim ──────────────────────────────────────────
console.log("Oliver's packages, part for part\n")

ok(
  find('DF-50').checks.join(' | ') === 'Remote controller | Power cord | Case',
  'DF-50: remote controller, power cord, case — three, not four ("remote controller, remote" is doubled)',
)
ok(
  find('Milwaukee').checks.join(' | ') ===
    'Milwaukee - Rapid Charger | Milwaukee - 12.0 Ah Forge Battery',
  'Milwaukee M18 blower: rapid charger + 12.0 Ah Forge battery',
)
ok(
  find('(Dewalt)').checks.join(' | ') === 'Dewalt Flexvolt Battery | Dewalt Flexvolt Charger',
  'Dewalt worklight: Flexvolt battery + charger',
)
ok(
  find('(Pelican)').checks.join(' | ') ===
    '9420 Spare Battery | 9420 Battery Charger | 9420 Power Supply | 9420 Power Cable | 9420 Pelican Case',
  'Pelican worklight: all five 9420 parts, in Oliver’s order',
)
ok(find('Steamer').checks.join(' | ') === 'Steamer Bottle', 'Wardrobe steamer: the bottle')
for (const label of ['Half (Table Top)', 'Rolling']) {
  ok(
    find(label).checks.join(' | ') === "Extension Cord - 25' | Globe Light Bulbs (10)",
    `Make up mirror ${label}: 25' cord + ten globe bulbs`,
  )
}

// ── The bulb colour stays out ────────────────────────────────────────
console.log('\nThe bulb colour is a per-order fact, not a check\n')

// Wes 2026-09-14: "just globe bulbs but indicate color as selected by
// client." A check prints identically on every order, so a colour in it
// would be wrong on half of them.
for (const c of KIT_CHECKLISTS) {
  for (const check of c.checks) {
    ok(
      !/2700|5000|warm white|daylight/i.test(check),
      `${c.label}: "${check}" names no colour`,
    )
  }
}

// ── Table hygiene ────────────────────────────────────────────────────
console.log('\nA table gets table things wrong\n')

for (const c of KIT_CHECKLISTS) {
  ok(c.codes.length > 0, `${c.label} targets at least one catalog code`)
  ok(c.checks.length > 0, `${c.label} lists at least one part`)
  ok(
    normalizeUnitChecks(c.checks).length === c.checks.length,
    `${c.label} has no duplicate or blank parts (normalize is a no-op)`,
  )
}

{
  const all = KIT_CHECKLISTS.flatMap((c) => c.codes)
  ok(new Set(all).size === all.length, 'no catalog code is claimed by two packages')
  ok(allChecklistCodes().length === new Set(all).size, 'allChecklistCodes() dedupes')
}

{
  // Unconfirmed twins are documentation, not targets — seeding a
  // checklist onto the wrong item is its own quiet failure.
  const confirmed = new Set(KIT_CHECKLISTS.flatMap((c) => c.codes))
  for (const c of KIT_CHECKLISTS) {
    for (const u of c.unconfirmed ?? []) {
      ok(!confirmed.has(u), `${c.label}: unconfirmed "${u}" is not seeded`)
    }
  }
}

// ── Lookup ───────────────────────────────────────────────────────────
console.log('\nLooking a code up\n')

ok(checklistForCode('104456')?.label.includes('Pelican') === true, '104456 → the Pelican worklight')
ok(checklistForCode('104417')?.label.includes('DF-50') === true, '104417 → the DF-50')
ok(checklistForCode('EFX-DF50-HAZER')?.label.includes('DF-50') === true,
  'the public DF-50 twin resolves to the same package')
ok(checklistForCode('nope') === null, 'an unknown code resolves to nothing, not a throw')

// ── The duplicate-row trap ───────────────────────────────────────────
console.log('\nThe DF-50 is seeded on every twin\n')

// The catalog carries this machine three times — an RW water row, an RW
// oil row and a hand-entered public row. A checklist on one twin leaves
// orders built off the others silently unchecked.
{
  const df50 = find('DF-50')
  ok(df50.codes.includes('104417'), 'the water-based RW row')
  ok(df50.codes.includes('104418'), 'the oil-based RW row')
  ok(df50.codes.includes('EFX-DF50-HAZER'), 'the public row')
}

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All kit-checklist checks passed.')
