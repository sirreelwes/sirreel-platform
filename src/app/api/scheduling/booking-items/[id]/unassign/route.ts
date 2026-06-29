/**
 * POST /api/scheduling/booking-items/[id]/unassign
 *
 * Clear ONE specific unit pick from a BookingItem (the "change / clear"
 * half of the unit-selection drawer). Removes a single ASSIGNED
 * BookingAssignment by assetId and, if the item was ASSIGNED and now
 * drops below full coverage, flips it back to REQUESTED so it returns
 * to the pooled state (and the stale-holds / needs-assignment lane).
 *
 * Distinct from `release` (which terminates the WHOLE item →
 * UNFULFILLED). This is a reversible pick change before checkout.
 *
 *   · ASSIGNED assignment   → deleted; item REQUESTED if now under qty.
 *   · CHECKED_OUT           → 409 (unit is physically out — use the
 *                             return flow, not a pick change).
 *   · not found on item     → 404.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDispatchAccess } from '@/lib/fleet/requireDispatchAccess'

export const dynamic = 'force-dynamic'

interface UnassignBody {
  assetId?: string
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const body = (await req.json().catch(() => null)) as UnassignBody | null
  if (!body?.assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })

  const bookingItem = await prisma.bookingItem.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      quantity: true,
      status: true,
      assignments: { select: { id: true, assetId: true, status: true } },
    },
  })
  if (!bookingItem) return NextResponse.json({ error: 'booking item not found' }, { status: 404 })

  const target = bookingItem.assignments.find((a) => a.assetId === body.assetId)
  if (!target) {
    return NextResponse.json({ error: 'asset is not assigned to this booking item' }, { status: 404 })
  }
  if (target.status === 'CHECKED_OUT') {
    return NextResponse.json(
      { error: 'cannot unassign', reason: 'unit is checked out — use the return flow, not a pick change' },
      { status: 409 },
    )
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.bookingAssignment.delete({ where: { id: target.id } })
    const remainingAssigned = bookingItem.assignments.length - 1
    // If the item was fully ASSIGNED and now has an open slot, return it
    // to REQUESTED so it re-enters the pooled / needs-assignment lane.
    let status = bookingItem.status
    if (bookingItem.status === 'ASSIGNED' && remainingAssigned < bookingItem.quantity) {
      await tx.bookingItem.update({ where: { id: bookingItem.id }, data: { status: 'REQUESTED' } })
      status = 'REQUESTED'
    }
    return { remainingAssigned, status }
  })

  return NextResponse.json({
    ok: true,
    bookingItem: {
      id: bookingItem.id,
      quantity: bookingItem.quantity,
      status: result.status,
      assignedCount: result.remainingAssigned,
      remaining: Math.max(0, bookingItem.quantity - result.remainingAssigned),
    },
  })
}
