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
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { getCategoryAvailability } from '@/lib/scheduling/availability'

export const dynamic = 'force-dynamic'

interface PromoteBody {
  force?: boolean
  bufferDays?: number
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // SALES action (per Wes): promoting a backup re-ranks the reservation queue —
  // a booking decision, not an assignment. Was canAssignAssets
  // (requireDispatchAccess); fleet/warehouse no longer pass.
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
      { error: 'forbidden', reason: 'promoting a backup is a sales action' },
      { status: 403 },
    )
  }
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

  // Capacity sanity-check: count CURRENT rank-1 quantity demand on
  // this category overlapping the window (REQUESTED + ASSIGNED
  // BookingItems with holdRank=1). After promotion this item joins
  // that pool — projected rank-1 demand = current + item.quantity.
  // If projected exceeds the category's serviceable unit count, two
  // primaries would compete for the same physical unit. Block
  // unless force=true.
  //
  // Why this check, not availableToHold: availableToHold subtracts
  // bookedCount which is computed per-UNIT (not per-assignment),
  // so a unit holding both a rank-1 and a rank-2 BookingAssignment
  // shows as bookedCount=1. That under-counts contention when
  // promoting the rank-2. Comparing rank-1 quantity demand against
  // serviceableCount is the right framing — rank-2's existing
  // assignment is irrelevant; what matters is "would there be more
  // primaries than units after this rank flip?"
  const availability = await getCategoryAvailability(item.categoryId, item.booking.startDate, item.booking.endDate, bufferDays)
  const rank1DemandAgg = await prisma.bookingItem.aggregate({
    where: {
      categoryId: item.categoryId,
      holdRank: 1,
      status: { in: ['REQUESTED', 'ASSIGNED'] },
      booking: {
        startDate: { lte: item.booking.endDate },
        endDate: { gte: item.booking.startDate },
      },
    },
    _sum: { quantity: true },
  })
  const currentRank1Quantity = rank1DemandAgg._sum.quantity ?? 0
  const projectedRank1Quantity = currentRank1Quantity + item.quantity

  if (!force && projectedRank1Quantity > availability.serviceableCount) {
    return NextResponse.json(
      {
        ok: false,
        error: 'capacity-conflict',
        reason: 'promoting would over-capacity — another primary holds this window',
        availability: {
          freeCount: availability.freeCount,
          bufferCount: availability.bufferCount,
          bookedCount: availability.bookedCount,
          availableToHold: availability.availableToHold,
          serviceableCount: availability.serviceableCount,
          currentRank1Quantity,
          projectedRank1Quantity,
        },
        suggestion: 'release the other primary first, or resubmit with force=true',
      },
      { status: 409 },
    )
  }

  // Promote the target AND renormalize the rest of the queue so the
  // active stack is contiguous starting at rank 1. Without this, a
  // promote of rank-2 leaves rank-3 still at rank 3 — a queue gap.
  // The renormalize touches only OTHER active items in the same
  // category whose Booking overlaps this item's window, and only
  // those with holdRank > 1 (so a stuck primary in the force=true
  // edge case isn't disturbed).
  const renormalized = await prisma.$transaction(async (tx) => {
    await tx.bookingItem.update({ where: { id: item.id }, data: { holdRank: 1 } })

    const others = await tx.bookingItem.findMany({
      where: {
        id: { not: item.id },
        categoryId: item.categoryId,
        status: { in: ['REQUESTED', 'ASSIGNED'] },
        holdRank: { gt: 1 },
        booking: {
          startDate: { lte: item.booking.endDate },
          endDate: { gte: item.booking.startDate },
        },
      },
      select: { id: true, holdRank: true },
      orderBy: { holdRank: 'asc' },
    })

    let nextRank = 2
    const renumbered: Array<{ id: string; from: number; to: number }> = []
    for (const o of others) {
      if (o.holdRank !== nextRank) {
        await tx.bookingItem.update({ where: { id: o.id }, data: { holdRank: nextRank } })
        renumbered.push({ id: o.id, from: o.holdRank, to: nextRank })
      }
      nextRank++
    }

    const final = await tx.bookingItem.findUnique({
      where: { id: item.id },
      select: { id: true, holdRank: true, status: true, quantity: true },
    })
    return { final, renumbered }
  })

  return NextResponse.json({
    ok: true,
    bookingItem: renormalized.final,
    booking: item.booking,
    forced: force && item.quantity > availability.availableToHold,
    renumbered: renormalized.renumbered,
  })
}
