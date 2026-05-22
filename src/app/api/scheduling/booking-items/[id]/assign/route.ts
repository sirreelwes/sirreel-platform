/**
 * POST /api/scheduling/booking-items/[id]/assign
 *
 * Chunk 5 of native-scheduling-v1-brief.md — assign one specific
 * Asset to a BookingItem. Re-runs the conflict check at assign time
 * for THIS asset (not the whole category). Two block modes:
 *
 *   409 over-capacity            — the asset has a hard overlap on
 *                                   the booking window. No override.
 *   409 buffer-encroachment      — asset is in buffer state for this
 *                                   window. Requires bufferOverride.
 *
 * On success, creates BookingAssignment(status=ASSIGNED) and flips
 * the parent BookingItem.status to ASSIGNED iff this assignment
 * brings the count to == quantity (full coverage). Partial coverage
 * keeps the BookingItem at REQUESTED so the Chunk 6 stale-holds view
 * still surfaces it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { computeUnitStates, type AssignmentWindow, type ServiceableAsset } from '@/lib/scheduling/availability'

export const dynamic = 'force-dynamic'

interface AssignBody {
  assetId?: string
  bufferDays?: number
  bufferOverride?: boolean
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => null)) as AssignBody | null
  if (!body) return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  if (!body.assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })
  const bufferDays = Number.isFinite(body.bufferDays) ? body.bufferDays! : 1

  const bookingItem = await prisma.bookingItem.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      categoryId: true,
      quantity: true,
      status: true,
      holdRank: true,
      booking: { select: { id: true, startDate: true, endDate: true } },
      assignments: { select: { id: true, assetId: true } },
    },
  })
  if (!bookingItem) return NextResponse.json({ error: 'booking item not found' }, { status: 404 })

  if (bookingItem.assignments.some((a) => a.assetId === body.assetId)) {
    return NextResponse.json({ error: 'this asset is already assigned to this booking item' }, { status: 409 })
  }
  if (bookingItem.assignments.length >= bookingItem.quantity) {
    return NextResponse.json(
      { error: 'booking item is already fully assigned', assignedCount: bookingItem.assignments.length, quantity: bookingItem.quantity },
      { status: 409 },
    )
  }

  const asset = await prisma.asset.findUnique({
    where: { id: body.assetId },
    select: { id: true, unitName: true, tier: true, categoryId: true, isActive: true, status: true },
  })
  if (!asset) return NextResponse.json({ error: 'asset not found' }, { status: 404 })
  if (asset.categoryId !== bookingItem.categoryId) {
    return NextResponse.json({ error: 'asset belongs to a different category' }, { status: 400 })
  }
  if (!asset.isActive || ['MAINTENANCE', 'RETIRED', 'SOLD', 'STOLEN'].includes(asset.status)) {
    return NextResponse.json({ error: 'asset is not serviceable', status: asset.status }, { status: 409 })
  }

  // Re-check conflict on this specific asset for the booking window.
  const windowStart = bookingItem.booking.startDate
  const windowEnd = bookingItem.booking.endDate
  const lookaround = Math.max(1, bufferDays + 1)
  const queryStart = new Date(windowStart.getTime() - lookaround * 86_400_000)
  const queryEnd = new Date(windowEnd.getTime() + lookaround * 86_400_000)

  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      assetId: body.assetId,
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      startDate: { lte: queryEnd },
      endDate: { gte: queryStart },
    },
    select: { assetId: true, startDate: true, endDate: true },
  })

  const serviceable: ServiceableAsset[] = [{ id: asset.id, unitName: asset.unitName, tier: asset.tier }]
  const stateRows = computeUnitStates(serviceable, assignments as AssignmentWindow[], windowStart, windowEnd, bufferDays)
  const state = stateRows[0]?.state ?? 'free'

  // Rank-aware overlap guard. Mirrors the rule the engine already
  // applies to category-level capacity (rank-1 holds consume,
  // rank ≥ 2 backups don't): rank-1 cannot bind to a unit that's
  // already held (double-book guard); rank-2+ may share the unit
  // with whatever's already there, queueing behind. The buffer
  // warning is also rank-gated — backups silent-skip it.
  //
  // Orphaned-backup case (a unit holding only a rank-2 after a
  // primary release-without-promote): the unit's state is still
  // 'booked' because the backup's BookingAssignment is active,
  // so a new rank-1 hits this guard and is blocked. That's
  // intentional — the policy is "promote the waiting backup
  // rather than let a new primary jump the queue."
  const itemRank = bookingItem.holdRank
  const isPrimaryItem = itemRank === 1

  if (state === 'booked' && isPrimaryItem) {
    return NextResponse.json(
      {
        ok: false,
        error: 'over-capacity',
        reason: 'asset has a hard overlap on this window; promote any existing backup instead of stacking a new primary',
        state,
      },
      { status: 409 },
    )
  }
  if (state === 'buffer' && isPrimaryItem && !body.bufferOverride) {
    return NextResponse.json(
      {
        ok: false,
        error: 'buffer-encroachment',
        reason: 'asset is in buffer state for this window; pass bufferOverride=true to proceed',
        needsOverride: true,
        state,
      },
      { status: 409 },
    )
  }
  // For rank ≥ 2, state==='booked' AND state==='buffer' both
  // pass through. The BookingAssignment is created on the same
  // asset and the engine continues to ignore rank-2+ for
  // availableToHold (verified by the capacity-1 test suite).

  // Persist atomically and (if appropriate) flip status to ASSIGNED.
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.bookingAssignment.create({
      data: {
        bookingItemId: bookingItem.id,
        assetId: asset.id,
        startDate: windowStart,
        endDate: windowEnd,
        status: 'ASSIGNED',
      },
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        asset: { select: { id: true, unitName: true, tier: true } },
      },
    })

    const newAssignedCount = bookingItem.assignments.length + 1
    let updatedItemStatus = bookingItem.status
    if (newAssignedCount >= bookingItem.quantity && bookingItem.status === 'REQUESTED') {
      await tx.bookingItem.update({ where: { id: bookingItem.id }, data: { status: 'ASSIGNED' } })
      updatedItemStatus = 'ASSIGNED'
    }
    return { created, newAssignedCount, updatedItemStatus }
  })

  return NextResponse.json(
    {
      ok: true,
      assignment: result.created,
      bookingItem: {
        id: bookingItem.id,
        quantity: bookingItem.quantity,
        status: result.updatedItemStatus,
        assignedCount: result.newAssignedCount,
        remaining: Math.max(0, bookingItem.quantity - result.newAssignedCount),
      },
      bufferOverrideUsed: state === 'buffer' && Boolean(body.bufferOverride),
    },
    { status: 201 },
  )
}
