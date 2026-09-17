/**
 * Cargo 20–25 have no lift gate (2026-09-16 — Wes).
 *
 * "We haven't successfully changed cargos 20 through 25 to be without a lift
 * gate. Instead we've added a second cargo 25 that has no lift gate but cargo
 * 25 with a lift gate still exists."
 *
 * Asserted, on the pure rules in src/lib/fleet/cargoLiftGate.ts:
 *   · every spelling of the two classes resolves to WITH / WITHOUT, and a
 *     bare "Cargo Van" resolves to NOTHING — the task never guesses;
 *   · the exact situation Wes described — the original in w/, a second row
 *     in w/o — folds the second into the original and moves the original;
 *     the row that was added by mistake is the one that goes;
 *   · a van with one row in w/ is moved; one row already in w/o is left
 *     alone; no active row anywhere is reported, never invented;
 *   · inactive rows are never a survivor and never folded;
 *   · a fold copies only what the survivor lacks, takes the higher
 *     odometer, and appends notes once;
 *   · the history-table list matches the Asset relations that exist, so a
 *     new relation cannot be forgotten silently;
 *   · the registry entry exists and names the CLI.
 *
 * Run: npm run test:cargo-lift-gate
 */
import {
  CARGO_NO_LIFT_GATE_UNITS, cargoClassOf, planCargoMoves, foldedUnitName, fillFromDuplicate,
  ASSET_HISTORY_RELATIONS, type CargoAssetRow,
} from '@/lib/fleet/cargoLiftGate'
import { MAINTENANCE_TASKS } from '@/lib/admin/maintenanceTasks'
import { readFileSync } from 'fs'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

console.log('\nThe six vans')
eq('the list', CARGO_NO_LIFT_GATE_UNITS, ['Cargo 20', 'Cargo 21', 'Cargo 22', 'Cargo 23', 'Cargo 24', 'Cargo 25'])

console.log('\nClass names')
eq('HQ w/', cargoClassOf('Cargo Van w/ Liftgate'), 'WITH')
eq('HQ w/o', cargoClassOf('Cargo Van w/o Liftgate'), 'WITHOUT')
eq('Planyo w/o', cargoClassOf('Cargo Vans w/o Liftgate'), 'WITHOUT')
eq('public tile', cargoClassOf('Cargo w/Lift Gate'), 'WITH')
eq('spelled out', cargoClassOf('Cargo Van without Lift Gate'), 'WITHOUT')
eq('"no lift gate"', cargoClassOf('Cargo Van, no lift gate'), 'WITHOUT')
eq('with lift gate', cargoClassOf('cargo van with liftgate'), 'WITH')
eq('bare "Cargo Van" says nothing', cargoClassOf('Cargo Van'), null)
eq('not a cargo class', cargoClassOf('Cube Truck'), null)
eq('a liftgate that is not a cargo van', cargoClassOf('Supercube Liftgate'), null)
eq('null', cargoClassOf(null), null)

const d = (iso: string) => new Date(iso)
const row = (id: string, unitName: string, cls: 'WITH' | 'WITHOUT', at: string, isActive = true): CargoAssetRow =>
  ({ id, unitName, cls, isActive, createdAt: d(at) })
const only = (plans: ReturnType<typeof planCargoMoves>, name: string) => plans.find((p) => p.unitName === name)!

console.log('\nThe situation Wes described')
{
  const plans = planCargoMoves([
    row('seed-cargo-20', 'Cargo 20', 'WITH', '2026-03-28'),
    row('seed-cargo-21', 'Cargo 21', 'WITH', '2026-03-28'),
    row('seed-cargo-22', 'Cargo 22', 'WITH', '2026-03-28'),
    row('planyo-22', 'Cargo 22', 'WITHOUT', '2026-05-23'),
    row('seed-cargo-23', 'Cargo 23', 'WITH', '2026-03-28'),
    row('seed-cargo-24', 'Cargo 24', 'WITH', '2026-03-28'),
    row('seed-cargo-25', 'Cargo 25', 'WITH', '2026-03-28'),
    row('planyo-25', 'Cargo 25', 'WITHOUT', '2026-05-23'),
    row('second-25', 'Cargo 25', 'WITHOUT', '2026-09-15'),
  ])
  eq('six plans, in order', plans.map((p) => p.unitName), [...CARGO_NO_LIFT_GATE_UNITS])
  eq('Cargo 20 moves', only(plans, 'Cargo 20').action, 'move')
  eq('Cargo 20 keeps the seed row', only(plans, 'Cargo 20').keep?.id, 'seed-cargo-20')
  eq('Cargo 25: fold then move', only(plans, 'Cargo 25').action, 'merge-and-move')
  eq('Cargo 25 survivor is the ORIGINAL in w/', only(plans, 'Cargo 25').keep?.id, 'seed-cargo-25')
  eq('Cargo 25 folds BOTH w/o rows', only(plans, 'Cargo 25').fold.map((f) => f.id), ['planyo-25', 'second-25'])
  eq('Cargo 22 likewise', only(plans, 'Cargo 22').fold.map((f) => f.id), ['planyo-22'])
  eq('nothing missing', plans.filter((p) => p.action === 'missing').length, 0)
}

console.log('\nAfter the run — idempotent')
{
  const plans = planCargoMoves([
    ...CARGO_NO_LIFT_GATE_UNITS.map((n, i) => row(`seed-${i}`, n, 'WITHOUT', '2026-03-28')),
    row('second-25', 'Cargo 25 (duplicate — folded 2026-09-16)', 'WITHOUT', '2026-09-15', false),
  ])
  yes('every unit in place', plans.every((p) => p.action === 'in-place'))
  yes('nothing to fold', plans.every((p) => p.fold.length === 0))
}

console.log('\nEdges')
{
  const plans = planCargoMoves([
    row('a', 'Cargo 20', 'WITHOUT', '2026-05-01'),
    row('b', 'Cargo 20', 'WITHOUT', '2026-04-01'),
    row('c', 'Cargo 20', 'WITHOUT', '2026-06-01'),
    row('old-21', 'Cargo 21', 'WITH', '2026-03-28', false),
    row('new-21', 'Cargo 21', 'WITHOUT', '2026-08-01'),
    row('retired-23', 'Cargo 23', 'WITH', '2026-03-28', false),
    row('w1-24', 'Cargo 24', 'WITH', '2026-03-28'),
    row('w2-24', 'Cargo 24', 'WITH', '2026-03-29'),
  ])
  eq('three in w/o: fold into the oldest', only(plans, 'Cargo 20').action, 'merge')
  eq('  the oldest survives', only(plans, 'Cargo 20').keep?.id, 'b')
  eq('  the others fold', only(plans, 'Cargo 20').fold.map((f) => f.id), ['a', 'c'])
  eq('inactive w/ row is not a survivor', only(plans, 'Cargo 21').keep?.id, 'new-21')
  eq('  and is not folded either', only(plans, 'Cargo 21').fold, [])
  eq('  it is listed', only(plans, 'Cargo 21').inactive.map((i) => i.id), ['old-21'])
  eq('  action', only(plans, 'Cargo 21').action, 'in-place')
  eq('only an inactive row → missing', only(plans, 'Cargo 23').action, 'missing')
  eq('  keep is null', only(plans, 'Cargo 23').keep, null)
  eq('no row at all → missing', only(plans, 'Cargo 22').action, 'missing')
  eq('two in w/: oldest survives, other folds, then move', only(plans, 'Cargo 24').action, 'merge-and-move')
  eq('  survivor', only(plans, 'Cargo 24').keep?.id, 'w1-24')
  eq('  folded', only(plans, 'Cargo 24').fold.map((f) => f.id), ['w2-24'])
  eq('a row named outside the list is ignored', planCargoMoves([row('x', 'Cargo 30', 'WITH', '2026-03-28')]).every((p) => p.action === 'missing'), true)
}

console.log('\nWhat the duplicate is left as')
eq('says duplicate and the date', foldedUnitName('Cargo 25', d('2026-09-16T20:00:00Z')), 'Cargo 25 (duplicate — folded 2026-09-16)')
yes('no longer matches the unit name', foldedUnitName('Cargo 25', new Date()) !== 'Cargo 25')

console.log('\nFilling the survivor from the duplicate')
{
  const fill = fillFromDuplicate(
    { vin: null, licensePlate: '8ABC123', year: 2017, make: 'Ford', model: null, accessCode: '', mileage: 69214, notes: 'original note' },
    { vin: '1FTYR2CM5HKA12345', licensePlate: '9ZZZ999', year: 2018, make: null, model: 'Transit Cargo', accessCode: '4321', mileage: 71000, notes: 'dup note' },
  )
  eq('copies the missing VIN', fill.vin, '1FTYR2CM5HKA12345')
  eq('never overwrites a plate on file', fill.licensePlate, undefined)
  eq('never overwrites a year on file', fill.year, undefined)
  eq('copies the missing model', fill.model, 'Transit Cargo')
  eq('an empty string counts as missing', fill.accessCode, '4321')
  eq('higher odometer wins', fill.mileage, 71000)
  eq('notes append', fill.notes, 'original note\ndup note')
  eq('nothing from an empty duplicate', fillFromDuplicate({ vin: 'X', mileage: 5, notes: 'n' }, { vin: null, mileage: 4, notes: '' }), {})
  eq('lower odometer ignored', fillFromDuplicate({ mileage: 5 }, { mileage: 4 }).mileage, undefined)
  eq('odometer fills a null', fillFromDuplicate({ mileage: null }, { mileage: 4 }).mileage, 4)
  eq('a note already present is not appended twice', fillFromDuplicate({ notes: 'a\ndup note' }, { notes: 'dup note' }).notes, undefined)
}

console.log('\nThe history tables — every Asset relation, none forgotten')
{
  // Read `model Asset` straight out of the schema: the list relations on it
  // are exactly the tables a fold has to re-point. A relation added to the
  // model without being added here would leave a folded duplicate's rows
  // behind, pointing at a retired unit.
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const start = schema.indexOf('\nmodel Asset {')
  const end = schema.indexOf('\n}', start)
  const body = schema.slice(start, end)
  const listRelations = Array.from(body.matchAll(/^\s+(\w+)\s+\w+\[\]/gm)).map((m) => m[1]).sort()
  eq('schema relations == ASSET_HISTORY_RELATIONS', listRelations, [...ASSET_HISTORY_RELATIONS].sort())
}

console.log('\nRegistry')
{
  const t = MAINTENANCE_TASKS.find((x) => x.id === 'cargo-vans-no-lift-gate')
  yes('registered', !!t)
  eq('backfill, not seed', t?.category, 'backfill')
  eq('names the CLI', t?.cliEquivalent, 'npx tsx scripts/cargo-vans-no-lift-gate.ts')
  yes('says it folds the duplicate', /duplicate/i.test(t?.summary ?? ''))
}

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
