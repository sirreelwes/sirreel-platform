/**
 * POST /api/scheduling/booking-items/[id]/release
 *
 * Chunk 6 of native-scheduling-v1-brief.md. One-click manual release
 * of a stale hold. Flips BookingItem.status from REQUESTED to
 * UNFULFILLED. Idempotent for already-UNFULFILLED items; rejects
 * release attempts on items in any other terminal state (ASSIGNED,
 * SUBSTITUTED) so we don't accidentally tear down active assignments.
 *
 * Does NOT cascade to the parent Booking — a Booking can have a mix
 * of fulfilled and released items; the agent decides whether to
 * archive the Booking separately.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const item = await prisma.bookingItem.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      quantity: true,
      _count: { select: { assignments: true } },
      booking: { select: { id: true, bookingNumber: true } },
    },
  })
  if (!item) return NextResponse.json({ error: 'booking item not found' }, { status: 404 })

  if (item.status === 'UNFULFILLED') {
    return NextResponse.json({ ok: true, alreadyReleased: true, bookingItemId: item.id })
  }

  if (item.status !== 'REQUESTED') {
    return NextResponse.json(
      {
        error: 'cannot release',
        reason: `BookingItem is in status=${item.status}; only REQUESTED items can be released. Detach assignments first if you need to roll back.`,
        bookingItemId: item.id,
        assignmentsCount: item._count.assignments,
      },
      { status: 409 },
    )
  }

  const updated = await prisma.bookingItem.update({
    where: { id: item.id },
    data: { status: 'UNFULFILLED' },
    select: { id: true, status: true, quantity: true },
  })

  return NextResponse.json({
    ok: true,
    bookingItem: updated,
    booking: item.booking,
  })
}
