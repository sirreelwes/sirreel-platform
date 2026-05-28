/**
 * POST /api/orders/[id]/fleet-ready          — stamps fleetReadyAt = now()
 * POST /api/orders/[id]/fleet-ready?undo=1   — reverses the stamp
 *
 * Phase 3 / commit 2 — the fleet-side trigger for the LOADED_READY
 * rollup. Today operators stamp fleetReadyAt manually via this
 * endpoint. When the digital fleet checkout flow lands later, IT will
 * stamp the same column on the same atomic transition — no rollup
 * changes needed.
 *
 * FORWARD PATH (no ?undo):
 *   Guards:
 *     - Order must exist.
 *     - Order.status === 'BOOKED' (forward-only — once past BOOKED,
 *       fleet-ready is implicit).
 *     - Order has ≥1 FLEET-routed line item (a fleet-ready stamp on a
 *       no-fleet order is meaningless — block it so operators don't
 *       create misleading audit rows).
 *     - Order.fleetReadyAt currently null (idempotent — re-press
 *       returns alreadyReady:true without a duplicate audit row).
 *   Effects:
 *     - Stamp Order.fleetReadyAt = now().
 *     - AuditLog row (action='order.fleet_ready').
 *     - Call the rollup. If warehouse lane is also done (or zero
 *       warehouse lines), this is what flips status to LOADED_READY
 *       and schedules LOADED_AND_READY cadence.
 *
 * UNDO PATH (?undo=1):
 *   Guards:
 *     - Order.fleetReadyAt currently non-null (nothing to undo otherwise).
 *     - Order.status ∈ {BOOKED, LOADED_READY} — DO NOT let undo work
 *       past ON_JOB (vehicles in client's possession; reverting fleet
 *       readiness from there would be a lie about reality).
 *   Effects:
 *     - If status === 'LOADED_READY': regress to BOOKED.
 *     - Clear fleetReadyAt.
 *     - AuditLog row (action='order.fleet_ready.undo').
 *     - No cadence rollback. If LOADED_AND_READY was already sent,
 *       too bad — the operator misclicked but the client got an email.
 *       (We could cancel an unfired event but the runner already
 *       state-gates and it's a corner case; flag it in the response.)
 *
 * Auth: any authenticated session, like /api/orders/[id]/book.
 * Captures userId + x-forwarded-for for the audit row.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { recomputeAndMaybeAdvanceLoadReady } from '@/lib/orders/loadReadyRollup'

export const dynamic = 'force-dynamic'

async function resolveUser(): Promise<{ userId: string | null; email: string | null }> {
  const session = await getServerSession()
  const email = session?.user?.email ?? null
  if (!email) return { userId: null, email: null }
  try {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    return { userId: u?.id ?? null, email }
  } catch {
    return { userId: null, email }
  }
}

function ipOf(req: NextRequest): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  )
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { userId } = await resolveUser()
  const ipAddress = ipOf(req)
  const isUndo = req.nextUrl.searchParams.get('undo') === '1'

  if (isUndo) return undoHandler({ orderId: params.id, userId, ipAddress })
  return forwardHandler({ orderId: params.id, userId, ipAddress })
}

async function forwardHandler(args: {
  orderId: string
  userId: string | null
  ipAddress: string | null
}) {
  const { orderId, userId, ipAddress } = args

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      fleetReadyAt: true,
      lineItems: { select: { fulfillmentLane: true } },
    },
  })
  if (!order) {
    return NextResponse.json({ error: 'order not found' }, { status: 404 })
  }

  if (order.fleetReadyAt) {
    return NextResponse.json({
      ok: true,
      alreadyReady: true,
      fleetReadyAt: order.fleetReadyAt,
    })
  }

  if (order.status !== 'BOOKED') {
    return NextResponse.json(
      {
        error: 'cannot mark fleet ready',
        reason: `order is in status=${order.status}; forward-only from BOOKED`,
        currentStatus: order.status,
      },
      { status: 409 },
    )
  }

  const fleetCount = order.lineItems.filter((li) => li.fulfillmentLane === 'FLEET').length
  if (fleetCount === 0) {
    return NextResponse.json(
      {
        error: 'no fleet lines',
        reason: 'order has zero FLEET-routed line items — fleet-ready is meaningless',
      },
      { status: 409 },
    )
  }

  const fleetReadyAt = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { fleetReadyAt },
    })
    await tx.auditLog.create({
      data: {
        userId,
        ipAddress,
        action: 'order.fleet_ready',
        entityType: 'Order',
        entityId: orderId,
        oldValues: { fleetReadyAt: null },
        newValues: { fleetReadyAt: fleetReadyAt.toISOString(), fleetLineCount: fleetCount },
      },
    })
  })

  // The rollup may now advance to LOADED_READY (warehouse also done /
  // zero warehouse lines) or stay at BOOKED (warehouse still picking).
  // Either way it's idempotent and safe.
  const rollup = await recomputeAndMaybeAdvanceLoadReady(orderId)

  return NextResponse.json({
    ok: true,
    fleetReadyAt,
    rollup,
  })
}

async function undoHandler(args: {
  orderId: string
  userId: string | null
  ipAddress: string | null
}) {
  const { orderId, userId, ipAddress } = args

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, fleetReadyAt: true },
  })
  if (!order) {
    return NextResponse.json({ error: 'order not found' }, { status: 404 })
  }

  if (!order.fleetReadyAt) {
    return NextResponse.json(
      { error: 'nothing to undo', reason: 'fleetReadyAt is already null' },
      { status: 409 },
    )
  }

  // Guard: undo only allowed up through LOADED_READY. Vehicles in
  // client's possession (ON_JOB or later) means reverting fleet
  // readiness would be a lie about reality.
  if (order.status !== 'BOOKED' && order.status !== 'LOADED_READY') {
    return NextResponse.json(
      {
        error: 'cannot undo',
        reason: `order is in status=${order.status}; undo allowed only from BOOKED or LOADED_READY`,
        currentStatus: order.status,
      },
      { status: 409 },
    )
  }

  const wasLoadedReady = order.status === 'LOADED_READY'
  const previousFleetReadyAt = order.fleetReadyAt

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        fleetReadyAt: null,
        // Regress status only if the LOADED_READY advance was caused
        // by this fleet-ready stamp. If status is still BOOKED, no
        // status change needed.
        ...(wasLoadedReady ? { status: 'BOOKED' } : {}),
      },
    })
    await tx.auditLog.create({
      data: {
        userId,
        ipAddress,
        action: 'order.fleet_ready.undo',
        entityType: 'Order',
        entityId: orderId,
        oldValues: {
          fleetReadyAt: previousFleetReadyAt.toISOString(),
          status: order.status,
        },
        newValues: {
          fleetReadyAt: null,
          status: wasLoadedReady ? 'BOOKED' : order.status,
          regressedFromLoadedReady: wasLoadedReady,
        },
      },
    })
  })

  return NextResponse.json({
    ok: true,
    undone: true,
    regressedToBooked: wasLoadedReady,
    // Note for the caller: if LOADED_AND_READY cadence event already
    // fired before this undo, it's already in the client's inbox. The
    // runner won't re-fire it (idempotent), but we can't unsend.
    cadenceNote: wasLoadedReady
      ? 'If LOADED_AND_READY email already sent, client already received it — cannot unsend.'
      : null,
  })
}
