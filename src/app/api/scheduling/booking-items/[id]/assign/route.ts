/**
 * POST /api/scheduling/booking-items/[id]/assign
 *
 * Chunk 5 of native-scheduling-v1-brief.md — assign one specific
 * Asset to a BookingItem. Two block modes:
 *
 *   409 over-capacity            — the asset has a hard overlap on
 *                                   the booking window. No override.
 *   409 buffer-encroachment      — asset is in buffer state for this
 *                                   window. Requires bufferOverride.
 *
 * The checks and the write live in lib/scheduling/assignUnit.ts since
 * 2026-09-10, because the order page binds a unit the moment a vehicle
 * line is added and has to refuse the same things this route refuses.
 * This file is auth + JSON.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { assignUnitToBookingItem } from '@/lib/scheduling/assignUnit'

export const dynamic = 'force-dynamic'

interface AssignBody {
  assetId?: string
  bufferDays?: number
  bufferOverride?: boolean
  /** Which order this unit goes out on. Optional: with one candidate
   *  order on the job we stamp it without asking. */
  orderId?: string
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // SALES action (2026-07 re-split): unit assignment is reservation control,
  // owned by canCreateBooking (AGENT/MANAGER/ADMIN). Deliberately NO ownership
  // check — assignment is shared coverage work. Fleet keeps documents/ops only.
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
      { error: 'forbidden', reason: 'assigning units is a sales action' },
      { status: 403 },
    )
  }
  const body = (await req.json().catch(() => null)) as AssignBody | null
  if (!body) return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  if (!body.assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })

  const result = await assignUnitToBookingItem({
    bookingItemId: params.id,
    assetId: body.assetId,
    bufferDays: body.bufferDays,
    bufferOverride: body.bufferOverride,
    orderId: body.orderId,
  })
  if (!result.ok) return NextResponse.json(result.body, { status: result.status })

  return NextResponse.json(
    {
      ok: true,
      assignment: result.assignment,
      bookingItem: result.bookingItem,
      bufferOverrideUsed: result.bufferOverrideUsed,
    },
    { status: 201 },
  )
}
