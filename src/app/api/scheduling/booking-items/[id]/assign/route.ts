/**
 * POST /api/scheduling/booking-items/[id]/assign
 *
 * Chunk 5 of native-scheduling-v1-brief.md — assign one specific
 * Asset to a BookingItem. Two block modes:
 *
 * A `replaceAssetId` in the body makes it a SWAP: that unit's assignment
 * is dropped and the new one bound in the same transaction, which is how
 * a fully-assigned date block changes trucks (Wes 2026-09-14).
 *
 *   409 over-capacity            — the asset is already out across the
 *                                   date block being filled. No override.
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
  /** The order LINE this unit is for (the picker opened from a line). */
  orderLineItemId?: string | null
  /** The date block being filled (YYYY-MM-DD), as shown in the picker.
   *  Optional — resolved from the quoted lines when absent. */
  windowStart?: string
  windowEnd?: string
  /** SWAP: the unit this one replaces on the same date block. Dropped and
   *  re-bound in one transaction, which is the only way a block that is
   *  already fully assigned can change trucks. */
  replaceAssetId?: string
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
    select: { id: true, role: true },
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
    orderLineItemId: body.orderLineItemId ?? null,
    windowStart: body.windowStart,
    windowEnd: body.windowEnd,
    replaceAssetId: body.replaceAssetId,
    actor: { userId: actor.id, source: 'assign-route' },
  })
  if (!result.ok) return NextResponse.json(result.body, { status: result.status })

  return NextResponse.json(
    {
      ok: true,
      assignment: result.assignment,
      bookingItem: result.bookingItem,
      bufferOverrideUsed: result.bufferOverrideUsed,
      window: result.window,
      replacedAssetId: result.replacedAssetId,
    },
    { status: 201 },
  )
}
