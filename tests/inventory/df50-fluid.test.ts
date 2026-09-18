/**
 * DF-50 hazer → fluid: the pure rule behind the maintenance task
 * (2026-09-17, Wes: "it's part of a kit").
 *
 * Run: npm run test:df50-fluid
 */
import { DF50_FLUID_CODE, DF50_HAZER_CODES, chooseDf50Fluid, isDf50FluidRow, isDf50MachineRow } from '@/lib/inventory/df50Fluid'
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

// The catalog as the first live run found it (Wes\'s screenshot,
// 2026-09-17): TWO fluid rows. The gallon is pinned; the typo'd row loses.
const gallon = { code: 'DF50FLUID', description: 'DF50 Hazer Fluid, 1 Gallon' }
const both = chooseDf50Fluid([efx, water, oil, fuid, gallon])
eq('two fluid rows: the gallon is chosen', both.fluid?.code, DF50_FLUID_CODE)
yes('…and the log says it was pinned', /pinned/.test(both.reason))
eq('the code match ignores case and padding', chooseDf50Fluid([{ code: ' df50fluid ', description: null }]).fluid?.code, ' df50fluid ')

// The pin is gone: one fluid-named row is taken, two are refused.
eq('no pin, one named row: taken', chooseDf50Fluid([efx, fuid]).fluid?.code, fuid.code)
const twoNamed = chooseDf50Fluid([efx, fuid, { code: 'X', description: 'DF-50 Fluid, quart' }])
eq('no pin, two named rows: nothing chosen', twoNamed.fluid, null)
yes('…and the refusal names both', /DF50 Hazer Fuid/.test(twoNamed.reason) && /quart/.test(twoNamed.reason))
eq('nothing at all', chooseDf50Fluid([efx, water, oil]).fluid, null)
yes('machines never count as the fluid', !/104417/.test(chooseDf50Fluid([efx, water, oil]).reason))

// The machine list is the pick-list check's list — one place, not two.
const check = KIT_CHECKLISTS.find((k) => k.label.startsWith('DF-50'))
eq('machine codes match the pick-list check', [...(check?.codes ?? [])], [...DF50_HAZER_CODES])
yes('the check no longer claims the DF-50 needs no fluid', !/pre-juiced/i.test(check?.note ?? ''))

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
