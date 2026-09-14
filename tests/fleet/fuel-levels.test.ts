/**
 * The fuel ladder and the "came back lower" comparison.
 *
 * Oliver, 2026-09-14, asked fleet be able to pick eighths. The risk in
 * adding rungs is not the rungs — it is that the list lived in EIGHT
 * hand-written copies plus a ninth hand-keyed fraction table, so a form
 * could offer a reading the API rejects (a 400 on submit, after the
 * photos), or two readings could compare as equal because the table
 * never learned one of them.
 *
 * This pins the three things that must stay true of the ladder: every
 * offered reading validates, the old five still mean exactly what they
 * used to, and the fractions come out monotonic without anyone typing
 * them.
 *
 * Run: npm run test:fuel-levels
 */
import {
  FUEL_LEVELS, VALID_FUEL, FUEL_LEVEL_ERROR, fuelFraction, cameBackLower,
} from '../../src/lib/fleet/fuelLevels'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = Object.is(got, want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${got}${ok ? '' : ` (want ${want})`}`)
}

console.log('Eighths are offered (Oliver, 2026-09-14):')
for (const rung of ['1/8', '3/8', '5/8', '7/8']) {
  eq(`  ${rung} on the ladder`, (FUEL_LEVELS as readonly string[]).includes(rung), true)
}

console.log('\nThe original five survive — readings already filed stay valid:')
for (const rung of ['full', '3/4', '1/2', '1/4', 'empty']) {
  eq(`  ${rung} still validates`, VALID_FUEL.has(rung), true)
}
eq('  full  is still 1   ', fuelFraction('full'), 1)
eq('  3/4   is still 0.75', fuelFraction('3/4'), 0.75)
eq('  1/2   is still 0.5 ', fuelFraction('1/2'), 0.5)
eq('  1/4   is still 0.25', fuelFraction('1/4'), 0.25)
eq('  empty is still 0   ', fuelFraction('empty'), 0)

console.log('\nEvery offered reading validates — a form can never post a 400:')
let offeredAllValid = true
for (const rung of FUEL_LEVELS) if (!VALID_FUEL.has(rung)) offeredAllValid = false
eq('  FUEL_LEVELS ⊆ VALID_FUEL', offeredAllValid, true)
eq('  ...and nothing else is', VALID_FUEL.size, FUEL_LEVELS.length)
eq('  the 400 names the real list', FUEL_LEVEL_ERROR.includes('5/8'), true)

console.log('\nFractions are derived, so they cannot drift from the ladder:')
eq('  7/8', fuelFraction('7/8'), 0.875)
eq('  5/8', fuelFraction('5/8'), 0.625)
eq('  3/8', fuelFraction('3/8'), 0.375)
eq('  1/8', fuelFraction('1/8'), 0.125)
let monotonic = true
for (let i = 1; i < FUEL_LEVELS.length; i++) {
  if (!(fuelFraction(FUEL_LEVELS[i])! < fuelFraction(FUEL_LEVELS[i - 1])!)) monotonic = false
}
eq('  ladder runs full → empty, strictly', monotonic, true)

console.log('\nUnknown and missing readings are not measurements:')
eq('  null       ', fuelFraction(null), null)
eq('  empty str  ', fuelFraction(''), null)
eq('  off-ladder ', fuelFraction('7/16'), null)

console.log('\ncameBackLower — an eighth down is now visible, and was not before:')
eq('  full → 7/8  is lower ', cameBackLower('full', '7/8'), true)
eq('  3/4  → 5/8  is lower ', cameBackLower('3/4', '5/8'), true)
eq('  1/2  → 1/2  is square', cameBackLower('1/2', '1/2'), false)
eq('  1/2  → 5/8  is fuller', cameBackLower('1/2', '5/8'), false)
// A shortfall nobody measured is not a shortfall. Getting this wrong
// puts a fuel charge on a truck whose gauge was never read.
eq('  unread out  claims nothing', cameBackLower(null, 'empty'), false)
eq('  unread back claims nothing', cameBackLower('full', null), false)
eq('  off-ladder  claims nothing', cameBackLower('full', 'quarter'), false)

console.log(fail === 0 ? '\nAll passed.' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
