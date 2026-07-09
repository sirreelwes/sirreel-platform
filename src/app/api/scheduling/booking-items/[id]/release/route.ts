/**
 * POST /api/scheduling/booking-items/[id]/release
 *
 * Release a hold at any active state. Originally Chunk 6 of the
 * brief — narrow stale-hold sweep (REQUESTED → UNFULFILLED).
 * Widened (Change 2 of the PART 2 backend prep for Timeline
 * backup sub-lanes) to also handle ASSIGNED items:
 *
 *   · REQUESTED  → UNFULFILLED. No assignments to touch.
 *   · ASSIGNED   → UNFULFILLED, AND each active BookingAssignment
 *                  is flipped to SWAPPED in the same transaction.
 *                  SWAPPED is terminal-but-auditable; the rows stay
 *                  so we can read history later. Backups (rank ≥ 2)
 *                  on the same window are NOT touched — releasing
 *                  a primary leaves the queue intact; promotion is
 *                  always manual.
 *   · UNFULFILLED → idempotent ok, alreadyReleased=true.
 *   · SUBSTITUTED → 409 (an already-terminal state we don't manage
 *                  through this route).
 *
 * Does NOT cascade to the parent Booking. A Booking can hold a
 * mix of UNFULFILLED + ASSIGNED items; archiving the parent is a
 * separate deliberate action.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

const ACTIVE_ASSIGNMENT_STATUSES = ['ASSIGNED', 'CHECKED_OUT'] as const

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  // SALES action (per Wes): releasing a hold (primary bar or backup)
  // terminates the reservation item — a booking decision, not an assignment.
  // Was canAssignAssets (requireDispatchAccess); fleet/warehouse no longer pass.
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  })
  if (!actor || !can(actor.role, 'canCreateBooking')) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'releasing a hold is a sales action' },
      { status: 403 },
    )
  }
  const item = await prisma.bookingItem.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      quantity: true,
      holdRank: true,
      _count: { select: { assignments: true } },
      booking: { select: { id: true, bookingNumber: true } },
    },
  })
  if (!item) return NextResponse.json({ error: 'booking item not found' }, { status: 404 })

  if (item.status === 'UNFULFILLED') {
    return NextResponse.json({ ok: true, alreadyReleased: true, bookingItemId: item.id })
  }
  if (item.status === 'SUBSTITUTED') {
    return NextResponse.json(
      {
        error: 'cannot release',
        reason: `BookingItem is in terminal status=${item.status}; release does not manage SUBSTITUTED rows. Restore the item before releasing if that's the intent.`,
        bookingItemId: item.id,
      },
      { status: 409 },
    )
  }

  const result = await prisma.$transaction(async (tx) => {
    let swappedAssignmentCount = 0
    if (item.status === 'ASSIGNED') {
      // Flip every active assignment on this item to SWAPPED.
      // Backups (different BookingItem.holdRank values on different
      // BookingItems) are untouched — we only modify the assignments
      // belonging to THIS BookingItem.
      const swapped = await tx.bookingAssignment.updateMany({
        where: {
          bookingItemId: item.id,
          status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        },
        data: { status: 'SWAPPED' },
      })
      swappedAssignmentCount = swapped.count
    }
    const updatedItem = await tx.bookingItem.update({
      where: { id: item.id },
      data: { status: 'UNFULFILLED' },
      select: { id: true, status: true, quantity: true, holdRank: true },
    })
    return { updatedItem, swappedAssignmentCount }
  })

  return NextResponse.json({
    ok: true,
    bookingItem: result.updatedItem,
    booking: item.booking,
    swappedAssignmentCount: result.swappedAssignmentCount,
    holdRank: item.holdRank,
  })
}
