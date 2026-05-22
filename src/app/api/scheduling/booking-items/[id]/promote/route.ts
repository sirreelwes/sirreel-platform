/**
 * POST /api/scheduling/booking-items/[id]/promote
 *
 * Part B of native-scheduling-v1-brief.md backup-hold work. Manual
 * promotion of a backup hold (holdRank ≥ 2) to primary (holdRank = 1).
 * Triggered by an agent after the primary on the same window has
 * been released or cancelled — V1 has NO auto-promotion per the brief.
 *
 * Guards:
 *  - Item must be holdRank ≥ 2 (already primary returns alreadyPromoted)
 *  - Item status must be REQUESTED or ASSIGNED (terminal statuses
 *    UNFULFILLED / SUBSTITUTED can't be promoted)
 *  - Re-checks capacity AS IF this were a fresh primary hold; if
 *    promoting would over-capacity (i.e. another primary still
 *    holds the same window), returns 409 unless body.force=true
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCategoryAvailability } from '@/lib/scheduling/availability'

export const dynamic = 'force-dynamic'

interface PromoteBody {
  force?: boolean
  bufferDays?: number
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => null)) as PromoteBody | null
  const force = body?.force === true
  const bufferDays = body?.bufferDays ?? 1

  const item = await prisma.bookingItem.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      holdRank: true,
      quantity: true,
      categoryId: true,
      booking: { select: { id: true, bookingNumber: true, startDate: true, endDate: true } },
    },
  })
  if (!item) return NextResponse.json({ error: 'booking item not found' }, { status: 404 })

  if (item.holdRank === 1) {
    return NextResponse.json({ ok: true, alreadyPromoted: true, bookingItemId: item.id })
  }
  if (item.status === 'UNFULFILLED' || item.status === 'SUBSTITUTED') {
    return NextResponse.json(
      { error: 'cannot promote', reason: `BookingItem.status=${item.status} — only REQUESTED/ASSIGNED backups are promotable` },
      { status: 409 },
    )
  }

  // Capacity sanity-check: if there's still a rank-1 primary on the
  // same window, promoting would put two primaries on top of each
  // other. Block unless force=true.
  const availability = await getCategoryAvailability(item.categoryId, item.booking.startDate, item.booking.endDate, bufferDays)
  if (!force && item.quantity > availability.availableToHold) {
    return NextResponse.json(
      {
        ok: false,
        error: 'capacity-conflict',
        reason: 'promoting would over-capacity — the primary on this window has not been released',
        availability: {
          freeCount: availability.freeCount,
          bufferCount: availability.bufferCount,
          bookedCount: availability.bookedCount,
          availableToHold: availability.availableToHold,
        },
        suggestion: 'release the primary first, or resubmit with force=true',
      },
      { status: 409 },
    )
  }

  const updated = await prisma.bookingItem.update({
    where: { id: item.id },
    data: { holdRank: 1 },
    select: { id: true, holdRank: true, status: true, quantity: true },
  })

  return NextResponse.json({
    ok: true,
    bookingItem: updated,
    booking: item.booking,
    forced: force && item.quantity > availability.availableToHold,
  })
}
