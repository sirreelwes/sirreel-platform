/**
 * The walk-around is Julian's DamageID shot list, in his exact order.
 *
 *   npx tsx tests/fleet/walkaround-slots.test.ts
 *   npm run test:walkaround-slots
 *
 * Pure + offline: no DB, no env.
 *
 * Pins (2026-09-15, Wes relaying Julian): "the text to follow damage IDs
 * on each photo… keep it in this exact order", with the driver's license
 * as the last shot of the check-out. Also pins the rules that keep old
 * photos and the driver pages working: ids are never renamed, every id
 * ever stored still resolves, the check-in has no licence slot, and the
 * picked inspector name is required and never the login.
 */

import {
  REQUIRED_POSITIONS,
  RETURN_POSITIONS,
  ALL_POSITIONS,
  PHOTO_GROUPS,
  DRIVERS_LICENSE_POSITION,
  positionLabel,
  normalizePosition,
  missingPositions,
} from '../../src/lib/fleet/photoPositions'
import { DRIVER_REQUIRED_POSITIONS, DRIVER_OPTIONAL_POSITIONS } from '../../src/lib/drivers/selfCheckout'
import { RETURN_REQUIRED_POSITIONS, RETURN_OPTIONAL_POSITIONS } from '../../src/lib/drivers/selfReturn'
import { WALKAROUND_CREW, normalizeInspectorName, inspectorDisplayName } from '../../src/lib/fleet/walkaroundCrew'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

// Julian's list, verbatim (curly apostrophe and all).
const JULIAN = [
  'Dashboard', 'Visors', 'Cup holders', 'Lockbox', 'Driver side rear', 'Rear tire', 'Fuel cap',
  'Driver side mirror', 'Driver side front', 'Front tire', 'Windshield', 'Front', 'Pass side mirror',
  'Front tire', 'Pass side front', 'Rear tire', 'Pass side rear', 'Rear', 'Inside roof',
  'Inside complete', 'Remote', 'Paperwork', 'Driver’s license',
]

const labels = REQUIRED_POSITIONS.map((p) => p.label)
check(`check-out is ${JULIAN.length} shots`, labels.length === JULIAN.length)
JULIAN.forEach((want, i) => check(`shot ${i + 1} is "${want}"`, labels[i] === want))
check('driver’s license is the last check-out shot', REQUIRED_POSITIONS[REQUIRED_POSITIONS.length - 1]?.id === DRIVERS_LICENSE_POSITION)

check('check-in is the same walk minus the license',
  RETURN_POSITIONS.map((p) => p.id).join() === REQUIRED_POSITIONS.filter((p) => p.id !== DRIVERS_LICENSE_POSITION).map((p) => p.id).join())
check('check-in has no license slot', !RETURN_POSITIONS.some((p) => p.id === DRIVERS_LICENSE_POSITION))

// Ids: unique, and every id that has ever been stored still resolves.
const ids = ALL_POSITIONS.map((p) => p.id)
check('slot ids are unique', new Set(ids).size === ids.length)
const EVER_STORED = [
  'FRONT', 'DRIVER_SIDE', 'REAR', 'PASSENGER_SIDE', 'INTERIOR', 'ODOMETER', 'FUEL_GAUGE',
  'FRONT_DRIVER_CORNER', 'REAR_DRIVER_CORNER', 'REAR_PASSENGER_CORNER', 'FRONT_PASSENGER_CORNER',
  'WHEEL_DRIVER_FRONT', 'WHEEL_DRIVER_REAR', 'WHEEL_PASSENGER_REAR', 'WHEEL_PASSENGER_FRONT',
  'ROOF', 'WINDSHIELD', 'FRONT_BUMPER', 'REAR_BUMPER', 'LIFT_GATE', 'DASH', 'CARGO_INTERIOR',
]
for (const id of EVER_STORED) {
  check(`stored id ${id} still normalizes`, normalizePosition(id) === id)
  check(`stored id ${id} still has a name`, positionLabel(id) !== id)
}
check('DAMAGE still normalizes', normalizePosition('DAMAGE') === 'DAMAGE')
check('unknown position drops to null', normalizePosition('NOPE') === null)

// Sections are contiguous runs, in PHOTO_GROUPS order — grouping can't reorder the walk.
const runs: string[] = []
for (const p of REQUIRED_POSITIONS) if (runs[runs.length - 1] !== p.group) runs.push(p.group)
check('each section is one contiguous run', new Set(runs).size === runs.length)
check('sections appear in PHOTO_GROUPS order',
  runs.every((g, i) => i === 0 || PHOTO_GROUPS.indexOf(g as never) > PHOTO_GROUPS.indexOf(runs[i - 1] as never)))

// The duplicate labels are disambiguated out of context.
check('driver rear tire reads with its side', positionLabel('WHEEL_DRIVER_REAR') === 'Rear tire · driver side')
check('passenger front tire reads with its side', positionLabel('WHEEL_PASSENGER_FRONT') === 'Front tire · passenger side')
const outOfContext = REQUIRED_POSITIONS.map((p) => positionLabel(p.id))
check('every check-out slot has a unique out-of-context name', new Set(outOfContext).size === outOfContext.length)

// Driver self-serve subsets still resolve (they use retired angles).
check('driver check-out: 4 required sides', DRIVER_REQUIRED_POSITIONS.length === 4)
check('driver check-out: 3 optional', DRIVER_OPTIONAL_POSITIONS.length === 3)
check('driver return: 4 required sides', RETURN_REQUIRED_POSITIONS.length === 4)
check('driver return: 3 optional', RETURN_OPTIONAL_POSITIONS.length === 3)

check('missing counts against the list passed', missingPositions(['DASH'], RETURN_POSITIONS).length === RETURN_POSITIONS.length - 1)

// Who did it.
check('crew buttons are Julian, Andy, Frankie', WALKAROUND_CREW.join() === 'Julian,Andy,Frankie')
check('blank name is no name', normalizeInspectorName('   ') === null)
check('non-string is no name', normalizeInspectorName(undefined) === null)
check('name is trimmed and single-spaced', normalizeInspectorName('  Frankie   R ') === 'Frankie R')
check('picked name beats the shared login',
  inspectorDisplayName({ inspectorName: 'Andy', inspectedByUser: { name: 'Fleet', email: 'fleet@sirreel.com' } }).name === 'Andy')
check('older rows fall back to the login name',
  inspectorDisplayName({ inspectorName: null, inspectedByUser: { name: 'Julian Ponce' } }).name === 'Julian Ponce')
check('driver rows say driver',
  inspectorDisplayName({ inspectedByUser: null, inspectedByDriver: { firstName: 'Joel', lastName: 'M' } }).byDriver === true)

if (failures.length) {
  console.error(`\n${failures.length} FAILED:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall walk-around slot checks passed')
