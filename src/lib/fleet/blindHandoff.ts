/**
 * Is THIS vehicle's handoff blind? — the one answer for everything that
 * hands a driver photo steps or a lockbox code.
 *
 * Wes 2026-09-16: "All drivers are being prompted to do the damage ID-style
 * photos when we only want that … when it is a blind pickup or a blind
 * return", and "we do not distribute the key lockbox code except on blind
 * handoffs."
 *
 * The flags live on the ORDER (Order.blindPickup / blindReturn), and every
 * reader used to ask "is ANY live order on the job blind?". The blind
 * toggles on the board and on Vehicle Check In/Out write every live order
 * of the job, so marking one van blind made every driver on that job a
 * blind pickup: photo check-out, and the lockbox code. Wrong Number
 * (SR-JOB-0273, 2026-09-16): the passenger vans' order was marked blind
 * return and the driver of a Cargo on a separate booking was offered the
 * self return too.
 *
 * The rule, per vehicle (its booking):
 *   1. Orders bound to the vehicle's booking decide it.
 *   2. With none bound, the job's UNBOUND orders decide it — no bookingId,
 *      or one pointing at a booking that is no longer live (a rebook leaves
 *      the order on its cancelled twin; SR-JOB-0311 did exactly that, and a
 *      blind driver there must still be able to check out).
 *   3. An order bound to a DIFFERENT live booking never speaks for this one.
 *
 * Known limit: one order can carry several vehicles on one booking (the
 * Wrong Number vans), and there is no per-vehicle flag, so those vehicles
 * share their order's answer.
 */

import { prisma } from '@/lib/prisma'

export interface BlindOrderLike {
  bookingId: string | null
  blindPickup: boolean
  blindReturn: boolean
}

/** The orders that speak for one booking (pure — see the rule above). */
export function ordersForBooking<T extends BlindOrderLike>(
  orders: T[],
  bookingId: string | null,
  liveBookingIds: ReadonlySet<string>,
): T[] {
  if (bookingId) {
    const bound = orders.filter((o) => o.bookingId === bookingId)
    if (bound.length) return bound
  }
  return orders.filter((o) => !o.bookingId || !liveBookingIds.has(o.bookingId))
}

export function blindFlags(orders: BlindOrderLike[]): { blindPickup: boolean; blindReturn: boolean; any: boolean } {
  const blindPickup = orders.some((o) => o.blindPickup)
  const blindReturn = orders.some((o) => o.blindReturn)
  return { blindPickup, blindReturn, any: blindPickup || blindReturn }
}

/** The job's live orders and live booking ids — what `ordersForBooking` needs. */
export async function loadJobBlindContext(jobId: string) {
  const [orders, bookings] = await Promise.all([
    prisma.order.findMany({
      where: { jobId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        bookingId: true,
        blindPickup: true,
        blindReturn: true,
        blindPickupInstructions: true,
        blindReturnInstructions: true,
      },
    }),
    prisma.booking.findMany({
      where: { jobId, status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null },
      select: { id: true },
    }),
  ])
  return { orders, liveBookingIds: new Set(bookings.map((b) => b.id)) }
}

/** Blind flags for one vehicle's booking, straight from the database. */
export async function blindHandoffForBooking(booking: { id: string; jobId: string | null }) {
  if (!booking.jobId) return { blindPickup: false, blindReturn: false, any: false }
  const ctx = await loadJobBlindContext(booking.jobId)
  return blindFlags(ordersForBooking(ctx.orders, booking.id, ctx.liveBookingIds))
}
