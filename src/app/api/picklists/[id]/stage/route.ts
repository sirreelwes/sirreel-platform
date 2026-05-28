/**
 * POST /api/picklists/[id]/stage — READY_TO_STAGE → STAGED.
 *
 * Bulk transitions every underlying OrderLineItem.pickStatus from
 * PICKED → STAGED, and flips the PickList itself to STAGED.
 *
 * Guards:
 *   - PickList must be in READY_TO_STAGE.
 *   - Every line item must currently be PICKED (defensive — Phase 2.x
 *     post-book line edits could introduce a freshly-added PENDING_PICK
 *     line). Returns 409 with the non-PICKED count.
 *
 * Role-gated to ADMIN | MANAGER.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePickerRole } from '@/lib/warehouse/requirePickerRole'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePickerRole()
  if (!auth.ok) return auth.response

  const picklist = await prisma.pickList.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      items: {
        select: { orderLineItem: { select: { id: true, pickStatus: true } } },
      },
    },
  })
  if (!picklist) {
    return NextResponse.json({ error: 'pick list not found' }, { status: 404 })
  }

  if (picklist.status === 'STAGED') {
    return NextResponse.json({ ok: true, alreadyStaged: true, picklistId: picklist.id })
  }
  if (picklist.status !== 'READY_TO_STAGE') {
    return NextResponse.json(
      {
        error: 'cannot stage',
        reason: `pick list is in status=${picklist.status}; stageable only from READY_TO_STAGE`,
        currentStatus: picklist.status,
      },
      { status: 409 },
    )
  }

  const nonPicked = picklist.items.filter((i) => i.orderLineItem.pickStatus !== 'PICKED')
  if (nonPicked.length > 0) {
    return NextResponse.json(
      {
        error: 'items not in PICKED state',
        reason: `${nonPicked.length} item${nonPicked.length === 1 ? '' : 's'} not yet PICKED — re-pick or remove`,
        nonPickedCount: nonPicked.length,
      },
      { status: 409 },
    )
  }

  const lineIds = picklist.items.map((i) => i.orderLineItem.id)
  await prisma.$transaction(async (tx) => {
    await tx.orderLineItem.updateMany({
      where: { id: { in: lineIds }, pickStatus: 'PICKED' },
      data: { pickStatus: 'STAGED' },
    })
    await tx.pickList.update({
      where: { id: picklist.id },
      data: { status: 'STAGED' },
    })
    await tx.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'picklist.staged',
        entityType: 'PickList',
        entityId: picklist.id,
        oldValues: { status: 'READY_TO_STAGE' },
        newValues: { status: 'STAGED', itemsStaged: lineIds.length },
      },
    })
  })

  return NextResponse.json({ ok: true, picklistId: picklist.id, itemsStaged: lineIds.length })
}
