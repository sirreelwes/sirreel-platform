/**
 * confirmBooking rule tests — the states a reservation may be confirmed
 * from, and the ones it must never be dragged out of.
 *
 *   npx tsx tests/bookings/confirm-booking.test.ts
 *   npm run test:confirm-booking
 *
 * The transition itself is one guarded updateMany and is exercised for
 * real by the route; what is worth pinning here is the DECISION, because
 * two callers now share it. bookOrder confirms the order's reservation
 * inside the book transaction, and the Timeline's Book action posts to
 * /api/scheduling/bookings/[id]/confirm. If CONFIRMABLE_FROM ever grew a
 * terminal state, "Book it" would quietly revive a cancelled booking
 * from inside a transaction nobody is watching.
 *
 * Asserted against the REAL Prisma enum rather than a hand-written list,
 * so a new BookingStatus fails here instead of silently landing in
 * whichever bucket the code happens to fall through to.
 */

import { BookingStatus } from '@prisma/client'
import { CONFIRMABLE_FROM, confirmOutcome, reservationsForOrder } from '../../src/lib/bookings/confirmBooking'
import { BOOKING_STATUS_VALUES, type BookingStatusValue } from '../../src/lib/bookings/status'

const failures: string[] = []

function check(cond: boolean, why: string): void {
  console.log(cond ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!cond) failures.push(why)
}

console.log('\nEvery confirmable state is a real BookingStatus')
{
  const real = Object.values(BookingStatus) as string[]
  const invented = CONFIRMABLE_FROM.filter((c) => !real.includes(c))
  check(invented.length === 0, `no invented status${invented.length ? ` (${invented.join(', ')})` : ''}`)
}

console.log('\nThe pre-confirmation states are all confirmable')
// Anything ahead of CONFIRMED in the lifecycle is somewhere a booking
// can legitimately be sitting when its order gets booked.
for (const s of ['REQUEST', 'AI_REVIEW', 'PENDING_APPROVAL'] as BookingStatusValue[]) {
  check(CONFIRMABLE_FROM.includes(s), `${s} can be confirmed`)
}

console.log('\nNothing at or past CONFIRMED can be confirmed again')
// CONFIRMED is handled as idempotent BEFORE this list is consulted, so it
// must not appear in it — and ACTIVE / RETURNED are further along still.
for (const s of ['CONFIRMED', 'ACTIVE', 'RETURNED'] as BookingStatusValue[]) {
  check(!CONFIRMABLE_FROM.includes(s), `${s} is not in CONFIRMABLE_FROM`)
}

console.log('\nA dead booking is never revived by booking an order')
// The one that matters. Booking an order must not resurrect a
// reservation somebody cancelled or shelved.
for (const s of ['CANCELLED', 'ARCHIVED'] as BookingStatusValue[]) {
  check(!CONFIRMABLE_FROM.includes(s), `${s} is not in CONFIRMABLE_FROM`)
}

console.log('\nEvery real status is deliberately in or out')
{
  const decided = BOOKING_STATUS_VALUES.filter(
    (s) => CONFIRMABLE_FROM.includes(s) || !CONFIRMABLE_FROM.includes(s),
  )
  check(decided.length === BOOKING_STATUS_VALUES.length, 'the mirror covers every status')
  const real = Object.values(BookingStatus) as string[]
  const unmirrored = real.filter((r) => !BOOKING_STATUS_VALUES.includes(r as BookingStatusValue))
  check(
    unmirrored.length === 0,
    `no status exists that this file has never considered${unmirrored.length ? ` (${unmirrored.join(', ')})` : ''}`,
  )
}

console.log('\nreservationsForOrder — every booking the order stands behind')
check(JSON.stringify(reservationsForOrder('b-video', [{ status: 'ASSIGNED', bookingId: 'b-video' }, { status: 'ASSIGNED', bookingId: 'b-cargo39' }])) === JSON.stringify(['b-video', 'b-cargo39']),
  'Lunch Rush: the linked booking AND the second hold bound to the order (Cargo 39)')
check(JSON.stringify(reservationsForOrder(null, [{ status: 'ASSIGNED', bookingId: 'b1' }])) === JSON.stringify(['b1']),
  'an order with no booking link still confirms the hold its truck is on')
check(JSON.stringify(reservationsForOrder('b1', [{ status: 'SWAPPED', bookingId: 'b-old' }])) === JSON.stringify(['b1']),
  'a SWAPPED truck does not drag its old booking along')
check(JSON.stringify(reservationsForOrder('b1', [{ status: 'CHECKED_OUT', bookingId: 'b2' }, { status: 'RETURNED', bookingId: 'b2' }])) === JSON.stringify(['b1', 'b2']),
  'duplicates collapse; checked-out and returned trucks still count')
check(reservationsForOrder(null, []).length === 0, 'nothing bound, nothing to confirm')
check(confirmOutcome({ ok: true, changed: true, previousStatus: 'REQUEST', booking: { id: 'x', bookingNumber: null, status: 'CONFIRMED', confirmedAt: null } }) === 'REQUEST→CONFIRMED', 'audit words for a real confirm')
check(confirmOutcome({ ok: false, reason: 'archived', booking: { id: 'x', bookingNumber: null, status: 'REQUEST', confirmedAt: null } }) === 'skipped:archived', 'audit words for a refusal')

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):\n`)
  failures.forEach((f) => console.error(`  - ${f}`))
  process.exit(1)
}
console.log('\nAll confirm-booking tests passed.\n')
