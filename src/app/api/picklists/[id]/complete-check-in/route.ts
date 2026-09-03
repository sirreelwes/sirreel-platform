/**
 * POST /api/picklists/[id]/complete-check-in — CHECKING_IN → CHECKED_IN.
 *
 * Closes the inbound pass. Every line must have been counted — a line
 * with `qtyReturned` still NULL is one nobody looked at, and closing
 * over it would turn "not counted" into "came back fine", which is the
 * exact confusion the nullable column exists to prevent.
 *
 * Shortfalls do NOT block the close. Gear goes missing; the point is to
 * record it, not to trap the warehouse in an open state until somebody
 * finds a battery. The response returns the shortfall list with
 * replacement costs so the caller can put it in front of whoever bills.
 *
 * Role-gated to the warehouse permission (ADMIN | MANAGER | WAREHOUSE).
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePickerRole } from '@/lib/warehouse/requirePickerRole'
import { settleJobReturnSafe } from '@/lib/fleet/settleJobReturn'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePickerRole()
  if (!auth.ok) return auth.response

  const picklist = await prisma.pickList.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      orderId: true,
      checkedInAt: true,
      // For the job-level rollup below — whichever lane closes last
      // stamps Job.returnedAt.
      order: { select: { jobId: true } },
      items: {
        select: {
          id: true,
          qtyReturned: true,
          returnNote: true,
          orderLineItem: {
            select: {
              id: true,
              description: true,
              quantity: true,
              autoKitPieceId: true,
              inventoryItem: { select: { code: true, replacementCost: true } },
            },
          },
        },
      },
    },
  })
  if (!picklist) {
    return NextResponse.json({ error: 'pick list not found' }, { status: 404 })
  }

  if (picklist.status === 'CHECKED_IN') {
    return NextResponse.json({
      ok: true,
      alreadyCheckedIn: true,
      picklistId: picklist.id,
      checkedInAt: picklist.checkedInAt,
    })
  }
  if (picklist.status !== 'CHECKING_IN') {
    return NextResponse.json(
      {
        error: 'cannot complete check-in',
        reason: `pick list is in status=${picklist.status}; completable only from CHECKING_IN`,
        currentStatus: picklist.status,
      },
      { status: 409 },
    )
  }

  const uncounted = picklist.items.filter((i) => i.qtyReturned == null)
  if (uncounted.length > 0) {
    return NextResponse.json(
      {
        error: 'items not counted',
        reason: `${uncounted.length} line${uncounted.length === 1 ? '' : 's'} still uncounted. Closing over them would record gear nobody looked at as returned in full.`,
        uncounted: uncounted.map((i) => ({
          itemId: i.id,
          description: i.orderLineItem.description,
          expected: i.orderLineItem.quantity,
        })),
      },
      { status: 409 },
    )
  }

  const shortfalls = picklist.items
    .filter((i) => (i.qtyReturned ?? 0) < i.orderLineItem.quantity)
    .map((i) => {
      const missing = i.orderLineItem.quantity - (i.qtyReturned ?? 0)
      const unit = i.orderLineItem.inventoryItem?.replacementCost
      return {
        itemId: i.id,
        lineItemId: i.orderLineItem.id,
        description: i.orderLineItem.description,
        code: i.orderLineItem.inventoryItem?.code ?? null,
        expected: i.orderLineItem.quantity,
        returned: i.qtyReturned ?? 0,
        missing,
        note: i.returnNote,
        // The accessory case is called out on its own: an included
        // charging bank the client was never charged for is exactly the
        // gear that used to walk off without a record.
        wasIncludedAccessory: !!i.orderLineItem.autoKitPieceId,
        replacementCostEach: unit ? unit.toString() : null,
        replacementCostTotal: unit ? (Number(unit) * missing).toFixed(2) : null,
      }
    })

  const checkedInAt = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.pickList.update({
      where: { id: picklist.id },
      data: { status: 'CHECKED_IN', checkedInAt, checkedInById: auth.userId },
    })
    await tx.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'picklist.checked_in',
        entityType: 'PickList',
        entityId: picklist.id,
        oldValues: { status: 'CHECKING_IN' },
        newValues: {
          status: 'CHECKED_IN',
          checkedInAt: checkedInAt.toISOString(),
          itemsCounted: picklist.items.length,
          shortfallCount: shortfalls.length,
          shortfalls,
        },
      },
    })
  })

  // Gear is one of two lanes that can be the last thing outstanding on
  // a job. settleJobReturn holds the shared rule and stamps
  // Job.returnedAt only when nothing is left in either lane — see
  // lib/fleet/settleJobReturn. Before this, closing a check-in left the
  // job reading "not returned" until somebody pressed the manual button.
  const settled = await settleJobReturnSafe(picklist.order?.jobId, auth.userId)

  return NextResponse.json({
    ok: true,
    picklistId: picklist.id,
    checkedInAt,
    itemsCounted: picklist.items.length,
    shortfalls,
    jobReturned: settled.stamped,
  })
}
