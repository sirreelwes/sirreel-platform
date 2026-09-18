/**
 * How much the driver is asked for, given what the yard already did.
 *
 *   npx tsx tests/drivers/self-checkout-duty.test.ts
 *   npm run test:driver-checkout-duty
 *
 * Pure + offline: no DB, no env.
 *
 * Pins Julian's rule (2026-09-17): "we have no need to prompt drivers for
 * checkout photos unless for some reason it is an unplanned pickup." His
 * process walks the vehicle around the day before, so on a PLANNED blind
 * pickup the condition is already on file and the driver is asked for
 * nothing. The unplanned case is the one with nothing on file, and there
 * the four sides stay required — that truck would otherwise leave with no
 * record of its condition in either direction.
 *
 * The property that matters most is the LAST one: photos are never taken
 * away, only un-demanded. A driver who finds fresh damage in the yard must
 * always be able to photograph it.
 */

import {
  driverCheckoutDuty,
  DRIVER_REQUIRED_POSITIONS,
  DRIVER_OPTIONAL_POSITIONS,
} from '../../src/lib/drivers/selfCheckout'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const ids = (list: { id: string }[]) => list.map((p) => p.id).sort().join(',')

console.log('nothing on file — the unplanned pickup')
{
  const d = driverCheckoutDuty({ onFile: false, mileage: null })
  check('the four sides are required', ids(d.required) === ids([...DRIVER_REQUIRED_POSITIONS]))
  check('mileage is required', d.mileageRequired)
  check('it says why', d.because === 'nothing-on-file')
  check(
    'the odometer, fuel and interior stay optional',
    ids(d.optional) === ids([...DRIVER_OPTIONAL_POSITIONS]),
  )
}

console.log('the yard walked it around — the planned blind pickup')
{
  const d = driverCheckoutDuty({ onFile: true, mileage: 41230 })
  check('NOTHING is required', d.required.length === 0)
  check('mileage is not demanded either — the yard read it', !d.mileageRequired)
  check('it says why', d.because === 'walkaround-on-file')
}

console.log('walked around but no odometer reading taken')
{
  const d = driverCheckoutDuty({ onFile: true, mileage: null })
  check('still no photos demanded', d.required.length === 0)
  check('but mileage IS, because nothing recorded it', d.mileageRequired)
}

console.log('a mileage of zero is a reading, not a blank')
{
  const d = driverCheckoutDuty({ onFile: true, mileage: 0 })
  check('0 counts as recorded', !d.mileageRequired)
}

console.log('the property that must never break')
{
  // Every slot the driver could ever shoot is still offered in BOTH
  // states. The rule un-demands photos; it never takes them away.
  const planned = driverCheckoutDuty({ onFile: true, mileage: 41230 })
  const unplanned = driverCheckoutDuty({ onFile: false, mileage: null })
  const offerable = (d: ReturnType<typeof driverCheckoutDuty>) => ids([...d.required, ...d.optional])
  check(
    'the same slots are reachable whether or not the yard walked it',
    offerable(planned) === offerable(unplanned),
  )
  check(
    'and that set is the four sides plus the extras',
    offerable(planned) === ids([...DRIVER_REQUIRED_POSITIONS, ...DRIVER_OPTIONAL_POSITIONS]),
  )
  check('a required slot is never also listed as optional', planned.required.length === 0)
  check(
    'unplanned: required and optional do not overlap',
    unplanned.required.every((r) => !unplanned.optional.some((o) => o.id === r.id)),
  )
}

console.log('required is always a subset of what the driver page can render')
{
  for (const walkaround of [
    { onFile: false, mileage: null },
    { onFile: true, mileage: null },
    { onFile: true, mileage: 100 },
  ]) {
    const d = driverCheckoutDuty(walkaround)
    const all = new Set([...DRIVER_REQUIRED_POSITIONS, ...DRIVER_OPTIONAL_POSITIONS].map((p) => p.id))
    if (!d.required.every((r) => all.has(r.id))) {
      failures.push(`required stays within the driver's own slots (${JSON.stringify(walkaround)})`)
    }
  }
  check('every state asks only for slots the driver page offers', true)
}

if (failures.length) {
  console.error(`\n${failures.length} failed:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nall good')
