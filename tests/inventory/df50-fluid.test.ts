/**
 * DF-50 hazer → fluid: the pure rule behind the maintenance task
 * (2026-09-17, Wes: "it's part of a kit").
 *
 * Run: npm run test:df50-fluid
 */
import { DF50_HAZER_CODES, chemistryOf, isDf50FluidRow, isDf50MachineRow, pairFluidsToMachines } from '@/lib/inventory/df50Fluid'
import { KIT_CHECKLISTS } from '@/lib/warehouse/kitChecklists'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

// The rows as the catalog spells them (exports/catalog-export.json).
const efx = { code: 'EFX-DF50-HAZER', description: 'DF50 Hazer' }
const water = { code: '104417', description: 'DF50 Hazer (Water Based)' }
const oil = { code: '104418', description: 'DF50 Hazer - Oil Based' }
const fuid = { code: 'DF50 Hazer Fuid', description: 'DF50 Hazer Fuid' }

// The fluid row, typo and all — code IS the name in the catalog.
yes('the typo\'d row is the fluid', isDf50FluidRow(fuid))
yes('spelled right is the fluid too', isDf50FluidRow({ code: 'DF50FLUID', description: 'DF-50 Hazer Fluid, gallon' }))
yes('"juice" counts', isDf50FluidRow({ code: 'X', description: 'DF 50 haze juice' }))
yes('a machine is not the fluid', !isDf50FluidRow(water))
yes('Rosco fluid is not DF-50 fluid', !isDf50FluidRow({ code: 'RVHAZER', description: 'Rosco V-Hazer fluid, 4 liter jug' }))
yes('a fluid is not a machine', !isDf50MachineRow(fuid))
yes('the machines are machines', [efx, water, oil].every(isDf50MachineRow))

// Chemistry off the name.
eq('water', chemistryOf(water), 'water')
eq('oil', chemistryOf(oil), 'oil')
eq('unsaid', chemistryOf(efx), null)

// One fluid row → every machine (today's catalog).
const one = pairFluidsToMachines([efx, water, oil], [fuid])
eq('one fluid: all three linked', one.map((p) => p.piece?.code), [fuid.code, fuid.code, fuid.code])

// Two fluids by chemistry → matched by name; the unsaid EFX row is refused
// rather than guessed.
const wf = { code: 'DF50W', description: 'DF-50 Fluid, Water Based' }
const of = { code: 'DF50O', description: 'DF-50 Fluid, Oil Based' }
const two = pairFluidsToMachines([efx, water, oil], [wf, of])
eq('two fluids: water machine gets water fluid', two[1].piece?.code, 'DF50W')
eq('two fluids: oil machine gets oil fluid', two[2].piece?.code, 'DF50O')
eq('two fluids: unsaid machine is refused', two[0].piece, null)
yes('two fluids: the refusal names the rows', /DF50W/.test(two[0].reason ?? '') && /DF50O/.test(two[0].reason ?? ''))

// A chemistry machine against a generic fluid plus one that says the OTHER
// chemistry: the generic one is the only sane pick.
const three = pairFluidsToMachines([water], [fuid, of])
eq('water machine, generic + oil fluids: generic', three[0].piece?.code, fuid.code)

// No fluid at all.
eq('no fluid: refused with a reason', pairFluidsToMachines([efx], [])[0].reason, 'no DF-50 fluid row in the catalog')

// The machine list is the pick-list check's list — one place, not two.
const check = KIT_CHECKLISTS.find((k) => k.label.startsWith('DF-50'))
eq('machine codes match the pick-list check', [...(check?.codes ?? [])], [...DF50_HAZER_CODES])
yes('the check no longer claims the DF-50 needs no fluid', !/pre-juiced/i.test(check?.note ?? ''))

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
