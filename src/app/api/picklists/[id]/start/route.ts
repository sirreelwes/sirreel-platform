/**
 * POST /api/picklists/[id]/start — DRAFT → PICKING.
 *
 * Stamps startedAt = now() and assigns the picker (session user) to
 * the list. Idempotent for PICKING (re-running just confirms the
 * existing state); rejects everything else with 409.
 *
 * No OrderLineItem changes — line statuses transition at item-pick
 * time, not here.
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
    select: { id: true, status: true, assignedToId: true, orderId: true },
  })
  if (!picklist) {
    return NextResponse.json({ error: 'pick list not found' }, { status: 404 })
  }

  if (picklist.status === 'PICKING') {
    return NextResponse.json({ ok: true, alreadyStarted: true, picklistId: picklist.id })
  }
  if (picklist.status !== 'DRAFT') {
    return NextResponse.json(
      {
        error: 'cannot start',
        reason: `pick list is in status=${picklist.status}; startable only from DRAFT`,
        currentStatus: picklist.status,
      },
      { status: 409 },
    )
  }

  const startedAt = new Date()
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.pickList.update({
      where: { id: picklist.id },
      data: {
        status: 'PICKING',
        startedAt,
        assignedToId: auth.userId,
      },
      select: { id: true, status: true, startedAt: true, assignedToId: true },
    })
    await tx.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'picklist.started',
        entityType: 'PickList',
        entityId: picklist.id,
        oldValues: { status: 'DRAFT' },
        newValues: { status: 'PICKING', startedAt: startedAt.toISOString(), assignedToId: auth.userId },
      },
    })
    return u
  })

  return NextResponse.json({ ok: true, picklist: updated })
}
