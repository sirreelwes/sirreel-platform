/**
 * Blind per VEHICLE, not per job — who gets photo steps and a lockbox code.
 *
 *   npx tsx tests/fleet/blind-handoff.test.ts
 *   npm run test:blind-handoff
 *
 * Pure + offline. Cases are the live shapes from 2026-09-16.
 */

import { blindFlags, ordersForBooking } from '../../src/lib/fleet/blindHandoff'

const failures: string[] = []
function check(got: unknown, want: unknown, why: string) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'ok' : 'FAIL'} — ${why}${ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
  if (!ok) failures.push(why)
}
const o = (bookingId: string | null, blindPickup = false, blindReturn = false) => ({ bookingId, blindPickup, blindReturn })
const flags = (orders: ReturnType<typeof o>[], booking: string, live: string[]) =>
  blindFlags(ordersForBooking(orders, booking, new Set(live)))

// Wrong Number: the vans' order (booking V) is blind return; a Cargo on
// booking C has no order of its own.
check(flags([o('V', false, true)], 'V', ['V', 'C']).blindReturn, true, 'the blind vans are blind')
check(flags([o('V', false, true)], 'C', ['V', 'C']).any, false, "another booking's blind order does not make this vehicle blind")

// MNX: one order, never bound to a booking.
check(flags([o(null, true)], 'B', ['B']).blindPickup, true, 'an unbound order speaks for the job')

// Rebook: the order still points at its CANCELLED twin.
check(flags([o('OLD', true)], 'NEW', ['NEW']).blindPickup, true, 'an order on a dead booking still counts (rebook)')

// Birdie: one bound order (not blind) + one unbound blind order.
const birdie = [o('F', false), o(null, true)]
check(flags(birdie, 'F', ['F', 'E']).any, false, 'a bound order outranks the unbound one')
check(flags(birdie, 'E', ['F', 'E']).blindPickup, true, 'an unbound order covers a booking with no order of its own')

// Staffed job.
check(flags([o('B')], 'B', ['B']), { blindPickup: false, blindReturn: false, any: false }, 'staffed: nothing is blind')

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\nall passed')
