import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import { pacificToday } from '@/lib/collections/billingQueue'

export const dynamic = 'force-dynamic'

/**
 * POST /api/collections/billing-queue/[orderId] — Ana's ruling on one row.
 *
 *   snooze   { until: 'YYYY-MM-DD', reason? }  come back on that day
 *   dismiss  { reason }                         not billed out of HQ
 *   restore  {}                                 put it back in the queue
 *
 * The queue is derived, so these are the only writes it has: everything
 * else about a row — when it came back, whether it has an invoice — is a
 * fact somewhere else, and a button here that changed one of those would be
 * a second source of truth for it.
 *
 * A reason is REQUIRED on both snooze and dismiss. The row is going to be
 * invisible to whoever looks at this queue tomorrow, and "why isn't
 * S260908-003 on the list" with no answer is exactly the hole the queue
 * exists to close.
 *
 * Every ruling writes an AuditLog row against the Order, because a
 * dismissal is the one action here that can make an order go unbilled.
 */

const MAX_SNOOZE_DAYS = 90

export async function POST(req: NextRequest, { params }: { params: { orderId: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown
    until?: unknown
    reason?: unknown
  }
  const action = typeof body.action === 'string' ? body.action.toLowerCase() : ''
  const reason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 2000)
      : null

  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    select: { id: true, orderNumber: true, billingMark: { select: { status: true } } },
  })
  if (!order) return NextResponse.json({ ok: false, error: 'order not found' }, { status: 404 })

  const today = pacificToday()

  if (action === 'restore') {
    // deleteMany, not delete: putting back a row that was never marked is a
    // no-op, not a 500. Two people clearing the same row is normal.
    await prisma.orderBillingMark.deleteMany({ where: { orderId: order.id } })
    if (order.billingMark) {
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'order.billing_queue_restore',
          entityType: 'Order',
          entityId: order.id,
          oldValues: { status: order.billingMark.status },
          newValues: { orderNumber: order.orderNumber },
        },
      })
    }
    return NextResponse.json({ ok: true, mark: null })
  }

  if (action !== 'snooze' && action !== 'dismiss') {
    return NextResponse.json(
      { ok: false, error: 'action must be snooze, dismiss or restore' },
      { status: 400 },
    )
  }

  if (!reason) {
    return NextResponse.json(
      { ok: false, error: 'say why — the row disappears from the queue and someone will ask' },
      { status: 400 },
    )
  }

  let snoozedUntil: Date | null = null
  if (action === 'snooze') {
    const until = typeof body.until === 'string' ? body.until : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      return NextResponse.json(
        { ok: false, error: 'until must be a YYYY-MM-DD date' },
        { status: 400 },
      )
    }
    if (until <= today) {
      return NextResponse.json(
        { ok: false, error: 'snooze to a future day — today is already due' },
        { status: 400 },
      )
    }
    // A snooze past the horizon is a dismissal wearing a disguise, and it
    // would take the order off the queue with no reason anyone reads.
    const days = Math.round(
      (Date.parse(`${until}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000,
    )
    if (days > MAX_SNOOZE_DAYS) {
      return NextResponse.json(
        { ok: false, error: `snooze at most ${MAX_SNOOZE_DAYS} days out — dismiss it instead` },
        { status: 400 },
      )
    }
    // @db.Date — UTC midnight, matching how every other day column is read.
    snoozedUntil = new Date(`${until}T00:00:00.000Z`)
  }

  const status = action === 'snooze' ? 'SNOOZED' : 'DISMISSED'
  const mark = await prisma.orderBillingMark.upsert({
    where: { orderId: order.id },
    create: { orderId: order.id, status, snoozedUntil, reason, markedById: user.id },
    // The latest ruling stands — a dismissal over a snooze, or a new date
    // over an old one. snoozedUntil is cleared on a dismissal so a stale
    // date can never read as a live snooze.
    update: { status, snoozedUntil, reason, markedById: user.id },
    select: { status: true, snoozedUntil: true, reason: true },
  })

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: action === 'snooze' ? 'order.billing_queue_snooze' : 'order.billing_queue_dismiss',
      entityType: 'Order',
      entityId: order.id,
      oldValues: { status: order.billingMark?.status ?? null },
      newValues: {
        orderNumber: order.orderNumber,
        status,
        snoozedUntil: snoozedUntil ? snoozedUntil.toISOString().slice(0, 10) : null,
        reason,
      },
    },
  })

  return NextResponse.json({
    ok: true,
    mark: {
      status: mark.status,
      snoozedUntil: mark.snoozedUntil ? mark.snoozedUntil.toISOString().slice(0, 10) : null,
      reason: mark.reason,
    },
  })
}
