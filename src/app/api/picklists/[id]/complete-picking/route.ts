/**
 * POST /api/picklists/[id]/complete-picking — PICKING → READY_TO_STAGE.
 *
 * Guards:
 *   - PickList must be in PICKING state.
 *   - Every underlying OrderLineItem.pickStatus must be 'PICKED' —
 *     i.e. nothing still PENDING_PICK. Returns 409 with the pending
 *     count so the UI can point the picker at what's left.
 *
 * No OrderLineItem changes — the bulk PICKED→STAGED transition happens
 * at the next button (POST /stage). This endpoint just gates the list
 * from "actively picking" into "ready to physically move to staging".
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
        select: { orderLineItem: { select: { pickStatus: true } } },
      },
    },
  })
  if (!picklist) {
    return NextResponse.json({ error: 'pick list not found' }, { status: 404 })
  }

  if (picklist.status === 'READY_TO_STAGE') {
    return NextResponse.json({ ok: true, alreadyComplete: true, picklistId: picklist.id })
  }
  if (picklist.status !== 'PICKING') {
    return NextResponse.json(
      {
        error: 'cannot complete picking',
        reason: `pick list is in status=${picklist.status}; completable only from PICKING`,
        currentStatus: picklist.status,
      },
      { status: 409 },
    )
  }

  const stillPending = picklist.items.filter((i) => i.orderLineItem.pickStatus === 'PENDING_PICK').length
  if (stillPending > 0) {
    return NextResponse.json(
      {
        error: 'items still pending',
        reason: `${stillPending} item${stillPending === 1 ? ' is' : 's are'} still PENDING_PICK`,
        pendingCount: stillPending,
      },
      { status: 409 },
    )
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.pickList.update({
      where: { id: picklist.id },
      data: { status: 'READY_TO_STAGE' },
      select: { id: true, status: true },
    })
    await tx.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'picklist.completed_picking',
        entityType: 'PickList',
        entityId: picklist.id,
        oldValues: { status: 'PICKING' },
        newValues: { status: 'READY_TO_STAGE', itemCount: picklist.items.length },
      },
    })
    return u
  })

  return NextResponse.json({ ok: true, picklist: updated })
}
