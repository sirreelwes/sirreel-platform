/**
 * GET /api/scheduling/order-hold?orderId=…&categoryId=…
 *
 * Which BookingItem did this order's vehicle line end up holding?
 *
 * The Make Reservation flow creates the Order, then POSTs the line —
 * and the line-items route mints the Booking + hold on its own
 * (`holdOnQuoteSend`, the "a vehicle is held the moment it is quoted"
 * rule). That path deliberately returns no ids: its `holds` block is
 * populated only for the OTHER branch, where the order already had a
 * Booking and `syncHoldOnLineAdd` ran.
 *
 * So the modal needs one read to find the hold it just caused, in
 * order to offer "assign the next available unit". Read-only, and
 * deliberately NOT a second write path — nothing here creates or
 * mutates a hold.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireReadSession } from '@/lib/scheduling/requireReadSession'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const denied = await requireReadSession()
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const orderId = searchParams.get('orderId')
  const categoryId = searchParams.get('categoryId')
  if (!orderId || !categoryId) {
    return NextResponse.json({ error: 'orderId and categoryId are required' }, { status: 400 })
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, bookingId: true },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  if (!order.bookingId) {
    // No hold was minted — the line resolved to no category, or the
    // hold attempt failed non-fatally upstream. Reported, not thrown:
    // the reservation itself is real, it just has nothing to assign.
    return NextResponse.json({ ok: true, bookingId: null, bookingItem: null })
  }

  // Rank is NOT pinned here, and that is deliberate. A freshly quoted
  // vehicle is held SOFT (rank 2) by holdOnQuoteSend; it only becomes
  // rank 1 when `reconcileHoldFirmness` sees an approved order with the
  // paperwork in. Filtering on rank 1 therefore found nothing at all on
  // a new reservation — the caller concluded "no hold" for a hold that
  // very much existed. Lowest rank wins, so a promoted primary is
  // preferred over a backup if both are somehow present.
  const bookingItem = await prisma.bookingItem.findFirst({
    where: { bookingId: order.bookingId, categoryId },
    orderBy: { holdRank: 'asc' },
    select: {
      id: true,
      quantity: true,
      status: true,
      holdRank: true,
      _count: { select: { assignments: true } },
    },
  })

  const booking = await prisma.booking.findUnique({
    where: { id: order.bookingId },
    select: { id: true, bookingNumber: true, startDate: true, endDate: true },
  })

  return NextResponse.json({
    ok: true,
    bookingId: order.bookingId,
    booking: booking
      ? {
          id: booking.id,
          bookingNumber: booking.bookingNumber,
          startDate: booking.startDate.toISOString().slice(0, 10),
          endDate: booking.endDate.toISOString().slice(0, 10),
        }
      : null,
    bookingItem: bookingItem
      ? {
          id: bookingItem.id,
          quantity: bookingItem.quantity,
          status: bookingItem.status,
          holdRank: bookingItem.holdRank,
          assignedCount: bookingItem._count.assignments,
          remaining: Math.max(0, bookingItem.quantity - bookingItem._count.assignments),
        }
      : null,
  })
}
