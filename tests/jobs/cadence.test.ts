/**
 * Job cadence rollup tests.
 *
 *   npx tsx tests/jobs/cadence.test.ts
 *   npm run test:cadence
 *
 * Pure + offline. The rollup is the ONE answer to "where is this job",
 * rendered on the /jobs rail and the job header. The case that matters
 * most already happened: on 2026-09-07 the driver had checked Cube 29
 * out on a blind pickup the night before, and Forgotten Island still
 * read "Booked · Ready to go out" — the order was never advanced, and
 * the rollup only read orders.
 */
import { rollupCadence, cadenceForOrder, cadenceForVehicle } from '../../src/lib/jobs/cadence'
import type { OrderStatus } from '@prisma/client'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const today = '2026-09-07', tomorrow = '2026-09-08'
const order = (status: OrderStatus, start: string, end: string) => ({ status, startDate: d(start), endDate: d(end) })

console.log('\ncadenceForVehicle')
eq(cadenceForVehicle({ status: 'ASSIGNED', endDate: d('2026-09-09') }, today, tomorrow), null, 'assigned but not out says nothing')
eq(cadenceForVehicle({ status: 'CHECKED_OUT', endDate: d('2026-09-09') }, today, tomorrow), 'on-rental', 'checked out, back in two days → on rental')
eq(cadenceForVehicle({ status: 'CHECKED_OUT', endDate: d(tomorrow) }, today, tomorrow), 'returning-tmw', 'checked out, back tomorrow')
eq(cadenceForVehicle({ status: 'CHECKED_OUT', endDate: d(today) }, today, tomorrow), 'returning-today', 'checked out, back today')
eq(cadenceForVehicle({ status: 'CHECKED_OUT', endDate: d('2026-09-01') }, today, tomorrow), 'on-rental', 'past its end date is STILL out (overdue is rowState\'s call)')
eq(cadenceForVehicle({ status: 'CHECKED_OUT', endDate: null }, today, tomorrow), 'on-rental', 'no end date → on rental')
eq(cadenceForVehicle({ status: 'RETURNED', endDate: d(today) }, today, tomorrow), null, 'returned says nothing')

console.log('\ncadenceForOrder — ON_JOB never reads booked')
eq(cadenceForOrder(order('ON_JOB', '2026-09-01', '2026-09-03'), today, tomorrow), 'on-rental', 'ON_JOB past its window is still out')
eq(cadenceForOrder(order('ON_JOB', '2026-09-10', '2026-09-12'), today, tomorrow), 'on-rental', 'ON_JOB before its window left early — still out')
eq(cadenceForOrder(order('LOADED_READY', '2026-09-10', '2026-09-12'), today, tomorrow), 'booked', 'LOADED_READY ahead of its window is still booked')
eq(cadenceForOrder(order('APPROVED', '2026-09-06', '2026-09-09'), today, tomorrow), 'booked', 'APPROVED mid-window with no truck out reads booked (the old Forgotten Island reading)')

console.log('\nrollupCadence — the Forgotten Island case')
const fi = [order('APPROVED', '2026-09-06', '2026-09-09')]
eq(rollupCadence('NEW', fi, today, tomorrow), { state: 'booked', partial: false }, 'no vehicle facts → booked (what shipped before)')
eq(rollupCadence('NEW', fi, today, tomorrow, [{ status: 'CHECKED_OUT', endDate: d('2026-09-09') }]), { state: 'on-rental', partial: false }, 'driver checked the truck out → On rental, order untouched')
eq(rollupCadence('NEW', fi, today, tomorrow, [{ status: 'ASSIGNED', endDate: d('2026-09-09') }]), { state: 'booked', partial: false }, 'truck assigned but not out → still booked')
eq(rollupCadence('NEW', [], today, tomorrow, [{ status: 'CHECKED_OUT', endDate: d('2026-09-09') }]), { state: 'on-rental', partial: false }, 'a reservation-only (Planyo-era) job with a truck out reads On rental too')

console.log('\nrollupCadence — precedence + off-ramps')
eq(rollupCadence('HOLD', fi, today, tomorrow, [{ status: 'CHECKED_OUT', endDate: d(today) }]), { state: 'hold', partial: false }, 'HOLD overrides even a truck on the road')
eq(rollupCadence('ACTIVE', [order('BOOKED', '2026-09-10', '2026-09-12')], today, tomorrow, [{ status: 'CHECKED_OUT', endDate: d(today) }]), { state: 'returning-today', partial: true }, 'one truck due back today, another order still ahead → partial return')
eq(rollupCadence('ACTIVE', [order('ON_JOB', '2026-09-06', '2026-09-09')], today, tomorrow, [{ status: 'CHECKED_OUT', endDate: d('2026-09-09') }]), { state: 'on-rental', partial: false }, 'order and truck agree → on rental, not partial')

console.log()
if (failures.length) { console.log(`${failures.length} failure(s)`); process.exit(1) }
console.log('all passed')
