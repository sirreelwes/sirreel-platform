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

  if (state === 'booked') {
    return NextResponse.json(
      { ok: false, error: 'over-capacity', reason: 'asset has a hard overlap on this window', state },
      { status: 409 },
    )
  }
  if (state === 'buffer' && !body.bufferOverride) {
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
