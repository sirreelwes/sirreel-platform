/**
 * POST /api/scheduling/booking-items/[id]/release
 *
 * Release a hold at any active state. Originally Chunk 6 of the
 * brief — narrow stale-hold sweep (REQUESTED → UNFULFILLED).
 * Widened (Change 2 of the PART 2 backend prep for Timeline
 * backup sub-lanes) to also handle ASSIGNED items:
 *
 *   · REQUESTED  → UNFULFILLED, AND any active BookingAssignment is
 *                  flipped to SWAPPED too. A partially-assigned item
 *                  is REQUESTED but DOES hold assignments; skipping
 *                  them left the unit held on the board.
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
    // Idempotent — but SELF-HEALING, not a bare no-op. An item can be
    // UNFULFILLED while still holding active assignments: every row
    // released before the fix below took the old REQUESTED path, which
    // skipped its assignments and left the unit reading as held. Re-calling
    // release on such a row previously returned "already released" and
    // changed nothing, so the truck stayed stuck forever.
    const healed = await prisma.bookingAssignment.updateMany({
      where: { bookingItemId: item.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
      data: { status: 'SWAPPED' },
    })
    return NextResponse.json({
      ok: true,
      alreadyReleased: true,
      bookingItemId: item.id,
      swappedAssignmentCount: healed.count,
    })
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
    // Flip every active assignment on this item to SWAPPED, whatever the
    // ITEM's status is. This used to be gated on item.status === 'ASSIGNED',
    // which stranded units: a PARTIALLY-assigned item stays REQUESTED while
    // already holding assignments (assigned count < quantity — the case the
    // stale-holds sweep explicitly includes), so releasing it freed the line
    // and left the truck reading as held on the board. Found releasing the
    // Planyo cancellation backlog 2026-08-24: Cube 10 stayed ASSIGNED for
    // Aug 26–Sep 1 after its hold was released.
    //
    // Unconditional is safe: the updateMany is already scoped to THIS item
    // and to active statuses, so an item with nothing assigned updates 0
    // rows. Backups on other BookingItems are untouched either way.
    const swapped = await tx.bookingAssignment.updateMany({
      where: {
        bookingItemId: item.id,
        status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
      },
      data: { status: 'SWAPPED' },
    })
    const swappedAssignmentCount = swapped.count
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
