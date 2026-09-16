/**
 * Checkout-state tests.
 *
 *   npm run test:checkout-state
 *
 * Wes 2026-09-16: "have they completed check out yet?" The raw fields
 * disagree, and the tempting one is wrong — the fleet walk-around writes a
 * CheckoutRecord with driverId NULL hours before anyone takes the keys, so
 * a van sitting on the lot carried a checkout time. What is pinned here is
 * the one rule that keeps AHA from telling a client their vans left when
 * they did not.
 */
import { checkoutState } from '../../src/lib/assistant/lookups'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const T = new Date('2026-09-16T14:00:00Z')
const walkAround = { checkoutTime: T, returnTime: null, driverReturnedAt: null, driverId: null }
const handover = { checkoutTime: T, returnTime: null, driverReturnedAt: null, driverId: 'drv_1' }

console.log('booked')
check('no record, no driver assignment', checkoutState({ status: 'ASSIGNED', checkoutRecords: [] }) === 'booked')
check('driver invited but nothing prepped', checkoutState({ status: 'ASSIGNED', checkoutRecords: [], driverAssignments: [{ status: 'INVITED', pickedUpAt: null }] }) === 'booked')
check('driver READY is still not collected', checkoutState({ status: 'ASSIGNED', checkoutRecords: [], driverAssignments: [{ status: 'READY', pickedUpAt: null }] }) === 'booked')

console.log('ready — the bug this exists to prevent')
check(
  'the walk-around alone is READY, never out',
  checkoutState({ status: 'ASSIGNED', checkoutRecords: [walkAround] }) === 'ready',
)
check(
  'a driver invited but not arrived, van inspected → still ready',
  checkoutState({ status: 'ASSIGNED', checkoutRecords: [walkAround], driverAssignments: [{ status: 'VIEWED', pickedUpAt: null }] }) === 'ready',
)

console.log('out')
check('a driver attached to the record', checkoutState({ status: 'ASSIGNED', checkoutRecords: [handover] }) === 'out')
check('the assignment says CHECKED_OUT', checkoutState({ status: 'CHECKED_OUT', checkoutRecords: [walkAround] }) === 'out')
check(
  'the driver says PICKED_UP even before the row catches up',
  checkoutState({ status: 'ASSIGNED', checkoutRecords: [walkAround], driverAssignments: [{ status: 'PICKED_UP', pickedUpAt: T }] }) === 'out',
)
check(
  'pickedUpAt alone counts',
  checkoutState({ status: 'ASSIGNED', checkoutRecords: [], driverAssignments: [{ status: 'VIEWED', pickedUpAt: T }] }) === 'out',
)

console.log('returned — beats everything')
check('staff return time', checkoutState({ status: 'CHECKED_OUT', checkoutRecords: [{ ...handover, returnTime: T }] }) === 'returned')
check("the driver's own return", checkoutState({ status: 'CHECKED_OUT', checkoutRecords: [{ ...handover, driverReturnedAt: T }] }) === 'returned')
check('a RETURNED row with no times', checkoutState({ status: 'RETURNED', checkoutRecords: [] }) === 'returned')
check(
  'returned wins over a PICKED_UP driver assignment',
  checkoutState({ status: 'CHECKED_OUT', checkoutRecords: [{ ...handover, returnTime: T }], driverAssignments: [{ status: 'PICKED_UP', pickedUpAt: T }] }) === 'returned',
)

if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
console.log('\nall passing')
