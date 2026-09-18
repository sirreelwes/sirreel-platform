/**
 * The DF-50's power cord: the pure rule behind the maintenance task
 * (2026-09-17, Wes: "It should be attached to the DF50 Hazer").
 *
 * Run: npm run test:df50-cord
 *
 * The thing worth guarding is the MATCH. The catalog is thick with Edison
 * cable that is not this cord, and the failure this task exists to undo —
 * a cord hung off a jug of fluid — is exactly what a loose match would
 * repeat somewhere else.
 */
import { chooseIecCord, cordIsMisplaced, isIecCordRow } from '@/lib/inventory/df50Cord'
import { DF50_HAZER_CODES } from '@/lib/inventory/df50Fluid'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

// The rows as the catalog spells them (exports/catalog-export.json).
const cord = { code: 'IEC POWER CORD EDISON', description: 'IEC POWER CORD EDISON' }
const stinger25 = { code: "25' EDISON CABLE (STINGER)", description: "25' EDISON CABLE (STINGER)" }
const stinger50 = { code: "50' EDISON CABLE (STINGER)", description: "50' EDISON CABLE (STINGER)" }
const adapter = { code: 'LED TUBE POWER ADAPTER TO EDISON - SINGLE', description: 'LED TUBE POWER ADAPTER TO EDISON - SINGLE' }
const fluid = { code: 'DF50FLUID', description: 'DF50 Hazer Fluid, 1 Gallon' }

console.log('\nWhat counts as the cord\n')
yes('the cord Wes named', isIecCordRow(cord))
yes('a 25ft stinger is NOT it', !isIecCordRow(stinger25))
yes('a 50ft stinger is NOT it', !isIecCordRow(stinger50))
yes('an Edison adapter is NOT it', !isIecCordRow(adapter))
yes('the fluid is NOT a cord', !isIecCordRow(fluid))
// "IEC" alone is not enough — a connector or a panel is not a cord.
yes('an IEC connector is not a cord', !isIecCordRow({ code: 'X', description: 'IEC inlet connector' }))
yes('"IEC cable" counts', isIecCordRow({ code: 'X', description: 'IEC cable, 6ft' }))

console.log('\nChoosing one\n')
eq('one match wins', chooseIecCord([cord, stinger25, fluid]).cord?.code, 'IEC POWER CORD EDISON')
eq('no match picks nothing', chooseIecCord([stinger25, adapter]).cord, null)
// Two cords is a catalog question, not something to guess at.
eq(
  'two matches refuse',
  chooseIecCord([cord, { code: 'IEC-CORD-2', description: 'IEC power cord, 10ft' }]).cord,
  null,
)
yes(
  'and the refusal names them',
  chooseIecCord([cord, { code: 'IEC-CORD-2', description: 'IEC power cord, 10ft' }]).reason.includes('IEC-CORD-2'),
)

console.log('\nWhere it may hang\n')
for (const code of DF50_HAZER_CODES) {
  yes(`${code} is a fine parent`, !cordIsMisplaced({ code, description: '' }, DF50_HAZER_CODES))
}
yes('the fluid is NOT a fine parent — the whole bug', cordIsMisplaced(fluid, DF50_HAZER_CODES))
yes(
  'nor is the typo\'d fluid row beside it',
  cordIsMisplaced({ code: 'DF50 Hazer Fuid', description: 'DF50 Hazer Fuid' }, DF50_HAZER_CODES),
)
yes('case and padding do not matter', !cordIsMisplaced({ code: ' efx-df50-hazer ', description: '' }, DF50_HAZER_CODES))

console.log('')
if (fail) {
  console.error(`${fail} failure(s)`)
  process.exit(1)
}
console.log('All DF-50 cord checks passed.')
