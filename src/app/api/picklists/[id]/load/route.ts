/**
 * POST /api/picklists/[id]/load — STAGED → LOADED.
 *
 * Terminal warehouse-lane transition. Bulk transitions every
 * underlying OrderLineItem.pickStatus from STAGED → LOADED, flips the
 * PickList itself to LOADED, and stamps completedAt = now().
 *
 * Phase 3 will read OrderLineItem.pickStatus to roll up the order to
 * LOADED_READY once the fleet lane is also terminal. That logic lives
 * outside this endpoint — keep this one focused on the warehouse-side
 * commit.
 *
 * Guards:
 *   - PickList must be in STAGED.
 *   - Every line item must currently be STAGED. Returns 409 with the
 *     non-STAGED count.
 *
 * Role-gated to ADMIN | MANAGER.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePickerRole } from '@/lib/warehouse/requirePickerRole'
import { recomputeAndMaybeAdvanceLoadReady } from '@/lib/orders/loadReadyRollup'

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
      items: {
        select: { orderLineItem: { select: { id: true, pickStatus: true } } },
      },
    },
  })
  if (!picklist) {
    return NextResponse.json({ error: 'pick list not found' }, { status: 404 })
  }

  if (picklist.status === 'LOADED') {
    return NextResponse.json({ ok: true, alreadyLoaded: true, picklistId: picklist.id })
  }
  if (picklist.status !== 'STAGED') {
    return NextResponse.json(
      {
        error: 'cannot load',
        reason: `pick list is in status=${picklist.status}; loadable only from STAGED`,
        currentStatus: picklist.status,
      },
      { status: 409 },
    )
  }

  const nonStaged = picklist.items.filter((i) => i.orderLineItem.pickStatus !== 'STAGED')
  if (nonStaged.length > 0) {
    return NextResponse.json(
      {
        error: 'items not in STAGED state',
        reason: `${nonStaged.length} item${nonStaged.length === 1 ? '' : 's'} not STAGED`,
        nonStagedCount: nonStaged.length,
      },
      { status: 409 },
    )
  }

  const completedAt = new Date()
  const lineIds = picklist.items.map((i) => i.orderLineItem.id)
  await prisma.$transaction(async (tx) => {
    await tx.orderLineItem.updateMany({
      where: { id: { in: lineIds }, pickStatus: 'STAGED' },
      data: { pickStatus: 'LOADED' },
    })
    await tx.pickList.update({
      where: { id: picklist.id },
      data: { status: 'LOADED', completedAt },
    })
    await tx.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'picklist.loaded',
        entityType: 'PickList',
        entityId: picklist.id,
        oldValues: { status: 'STAGED' },
        newValues: {
          status: 'LOADED',
          completedAt: completedAt.toISOString(),
          itemsLoaded: lineIds.length,
        },
      },
    })
  })

  // Phase 3 — warehouse lane just hit terminal. Trigger the rollup;
  // if fleet is also done (or zero fleet lines), this is where the
  // order advances to LOADED_READY and LOADED_AND_READY fires. The
  // rollup is idempotent and safe regardless of fleet state.
  let rollup: Awaited<ReturnType<typeof recomputeAndMaybeAdvanceLoadReady>> | null = null
  try {
    rollup = await recomputeAndMaybeAdvanceLoadReady(picklist.orderId)
  } catch (err) {
    console.error('[picklists/load] LOADED_READY rollup failed:', err)
    // Non-fatal — pick list is LOADED. Rollup can be retried via the
    // fleet-ready endpoint or any subsequent trigger.
  }

  return NextResponse.json({
    ok: true,
    picklistId: picklist.id,
    completedAt,
    itemsLoaded: lineIds.length,
    rollup,
  })
}
