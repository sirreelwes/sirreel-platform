/**
 * POST /api/picklists/[id]/check-in — LOADED → CHECKING_IN.
 *
 * Opens the inbound pass. Until this shipped, LOADED was the terminal
 * warehouse state and nothing counted gear back: twelve radios could go
 * out with six spare batteries and come back with two, and no surface in
 * HQ would ever say so. The pick list already enumerates exactly what
 * left the building — including the kit pieces that ride along free —
 * so the return sheet is that same list, counted the other direction.
 *
 * The transition is deliberately manual. Nothing about a truck arriving
 * proves the gear was counted, and a status that advances on its own
 * would read as "checked" to whoever bills the client next week.
 *
 * Guards:
 *   - PickList must be LOADED (or already CHECKING_IN — idempotent).
 *
 * Role-gated to the warehouse permission (ADMIN | MANAGER | WAREHOUSE).
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
    select: { id: true, status: true, orderId: true, checkInStartedAt: true },
  })
  if (!picklist) {
    return NextResponse.json({ error: 'pick list not found' }, { status: 404 })
  }

  if (picklist.status === 'CHECKING_IN') {
    return NextResponse.json({
      ok: true,
      alreadyCheckingIn: true,
      picklistId: picklist.id,
      checkInStartedAt: picklist.checkInStartedAt,
    })
  }
  if (picklist.status !== 'LOADED') {
    return NextResponse.json(
      {
        error: 'cannot start check-in',
        reason: `pick list is in status=${picklist.status}; check-in opens only from LOADED`,
        currentStatus: picklist.status,
      },
      { status: 409 },
    )
  }

  const checkInStartedAt = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.pickList.update({
      where: { id: picklist.id },
      data: { status: 'CHECKING_IN', checkInStartedAt },
    })
    await tx.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'picklist.check_in_started',
        entityType: 'PickList',
        entityId: picklist.id,
        oldValues: { status: 'LOADED' },
        newValues: { status: 'CHECKING_IN', checkInStartedAt: checkInStartedAt.toISOString() },
      },
    })
  })

  return NextResponse.json({ ok: true, picklistId: picklist.id, checkInStartedAt })
}
