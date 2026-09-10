/**
 * Confirming a booking — the one rule, shared by everything that does it.
 *
 * There were two paths to a confirmed reservation and only one of them
 * actually confirmed anything. The Timeline's Book action posts to
 * /api/scheduling/bookings/[id]/confirm, which flips the status; the
 * ORDER's "Book it" (bookOrder.ts) never touched Booking.status at all.
 * So an order could be BOOKED — money snapshotted, lanes routed, client
 * emailed — while its reservation still read REQUEST. Measured
 * 2026-09-09: 8 of the 16 booked-or-later orders carrying a booking link
 * pointed at a REQUEST booking. Swept by hand, then this.
 *
 * Deliberately inert, and that is the contract both callers rely on: no
 * cadence, no email, no touching backups, items or assignments. Just the
 * status and confirmedAt. In particular it does NOT touch BookingItem —
 * Booking.status is the CLIENT COMMITMENT and BookingItem.status is UNIT
 * ALLOCATION, and they are separate axes. A confirmed booking whose item
 * is still REQUESTED with no truck behind it is a normal, honest state,
 * and it stays visible to the assign-units action item rather than being
 * papered over.
 *
 * Forward-only and guarded: CONFIRMED is idempotent, and the terminal
 * states plus ACTIVE are refused rather than walked backwards — those
 * need their own action paths, not a casual "book it".
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import type { BookingStatusValue } from '@/lib/bookings/status'

type Db = Prisma.TransactionClient | PrismaClient

/** The states a confirm may move forward from. */
export const CONFIRMABLE_FROM: readonly BookingStatusValue[] = [
  'REQUEST', 'AI_REVIEW', 'PENDING_APPROVAL',
] as const

export interface ConfirmedBooking {
  id: string
  bookingNumber: string | null
  status: BookingStatusValue
  confirmedAt: Date | null
}

export type ConfirmBookingResult =
  /** This call is what confirmed it. */
  | { ok: true; changed: true; previousStatus: BookingStatusValue; booking: ConfirmedBooking }
  /** Already confirmed — not an error, and not a second confirmation. */
  | { ok: true; changed: false; booking: ConfirmedBooking }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'archived'; booking: ConfirmedBooking }
  | { ok: false; reason: 'not-confirmable'; booking: ConfirmedBooking }

const SELECT = {
  id: true, bookingNumber: true, status: true, confirmedAt: true, archivedAt: true,
} as const

/**
 * Confirm one booking. Safe to call speculatively — every not-ok result
 * is a fact about the booking, never a thrown error, so a caller that
 * confirms as a side effect (bookOrder) can report and carry on.
 */
export async function confirmBooking(db: Db, bookingId: string): Promise<ConfirmBookingResult> {
  const booking = await db.booking.findUnique({ where: { id: bookingId }, select: SELECT })
  if (!booking) return { ok: false, reason: 'not-found' }

  const row: ConfirmedBooking = {
    id: booking.id,
    bookingNumber: booking.bookingNumber,
    status: booking.status as BookingStatusValue,
    confirmedAt: booking.confirmedAt,
  }

  // An archived booking is refused even from a confirmable status —
  // restore it first, so nothing quietly revives a shelved reservation.
  if (booking.archivedAt) return { ok: false, reason: 'archived', booking: row }
  if (booking.status === 'CONFIRMED') return { ok: true, changed: false, booking: row }
  if (!CONFIRMABLE_FROM.includes(booking.status as BookingStatusValue)) {
    return { ok: false, reason: 'not-confirmable', booking: row }
  }

  // updateMany with the status guard rather than update: two people
  // clicking Book, or a book racing the Timeline's confirm, must not
  // re-stamp confirmedAt on a reservation that is already agreed.
  const res = await db.booking.updateMany({
    where: { id: bookingId, status: { in: [...CONFIRMABLE_FROM] as never[] }, archivedAt: null },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  })
  if (res.count === 0) {
    // Somebody else got there between the read and the write. Re-read so
    // the caller is told the truth rather than a guess.
    const now = await db.booking.findUnique({ where: { id: bookingId }, select: SELECT })
    if (!now) return { ok: false, reason: 'not-found' }
    const fresh: ConfirmedBooking = {
      id: now.id, bookingNumber: now.bookingNumber,
      status: now.status as BookingStatusValue, confirmedAt: now.confirmedAt,
    }
    return now.status === 'CONFIRMED'
      ? { ok: true, changed: false, booking: fresh }
      : { ok: false, reason: 'not-confirmable', booking: fresh }
  }

  const after = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: SELECT })
  return {
    ok: true,
    changed: true,
    previousStatus: booking.status as BookingStatusValue,
    booking: {
      id: after.id, bookingNumber: after.bookingNumber,
      status: after.status as BookingStatusValue, confirmedAt: after.confirmedAt,
    },
  }
}
