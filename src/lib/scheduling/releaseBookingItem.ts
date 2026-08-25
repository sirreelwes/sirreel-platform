/**
 * The one place a hold is released.
 *
 * Extracted from POST /api/scheduling/booking-items/[id]/release so the
 * endpoint and the Planyo auto-release cron share a single
 * implementation — two copies of "release a hold" would drift, and the
 * drift would show up as trucks stuck on the board.
 *
 * Semantics (unchanged from the endpoint):
 *   · item → UNFULFILLED
 *   · every ACTIVE assignment on that item → SWAPPED, regardless of the
 *     item's prior status. A partially-assigned item sits at REQUESTED
 *     while holding assignments; gating on ASSIGNED stranded the unit.
 *   · already UNFULFILLED → idempotent, but still sweeps active
 *     assignments so rows stranded by the old behaviour can be healed.
 *   · SUBSTITUTED → refused; a terminal state this doesn't manage.
 *
 * NOT the same thing as reconcileHolds.applyRelease, which DELETES the
 * BookingItem and needs the row present in the Planyo pull. This is the
 * non-destructive form: the rows stay, auditable.
 */

import { prisma } from '@/lib/prisma'

const ACTIVE_ASSIGNMENT_STATUSES = ['ASSIGNED', 'CHECKED_OUT'] as const

export type ReleaseOutcome =
  | { ok: true; alreadyReleased: boolean; bookingItemId: string; swappedAssignmentCount: number }
  | { ok: false; reason: string; code: 'NOT_FOUND' | 'TERMINAL' }

export async function releaseBookingItem(bookingItemId: string): Promise<ReleaseOutcome> {
  const item = await prisma.bookingItem.findUnique({
    where: { id: bookingItemId },
    select: { id: true, status: true },
  })
  if (!item) return { ok: false, reason: 'booking item not found', code: 'NOT_FOUND' }

  if (item.status === 'SUBSTITUTED') {
    return {
      ok: false,
      code: 'TERMINAL',
      reason: `BookingItem is in terminal status=${item.status}; release does not manage SUBSTITUTED rows. Restore the item before releasing if that's the intent.`,
    }
  }

  if (item.status === 'UNFULFILLED') {
    const healed = await prisma.bookingAssignment.updateMany({
      where: { bookingItemId: item.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
      data: { status: 'SWAPPED' },
    })
    return { ok: true, alreadyReleased: true, bookingItemId: item.id, swappedAssignmentCount: healed.count }
  }

  return prisma.$transaction(async (tx) => {
    const swapped = await tx.bookingAssignment.updateMany({
      where: { bookingItemId: item.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
      data: { status: 'SWAPPED' },
    })
    await tx.bookingItem.update({ where: { id: item.id }, data: { status: 'UNFULFILLED' } })
    return {
      ok: true as const,
      alreadyReleased: false,
      bookingItemId: item.id,
      swappedAssignmentCount: swapped.count,
    }
  })
}
