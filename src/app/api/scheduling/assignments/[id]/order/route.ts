/**
 * PATCH /api/scheduling/assignments/[id]/order — say which order this
 * unit is going out on (or take the attachment off).
 *
 * Hugo, 2026-09-03: "if sales has already associated an order and a
 * vehicle — sales needs to say which vehicle gets the order and then
 * that vehicle should have an 'Order Attached' indicator."
 *
 * SALES action, same gate as every other unit-assignment control:
 * canCreateBooking (AGENT / MANAGER / ADMIN). The yard reads the
 * indicator; it does not set it.
 *
 * The order must belong to the same JOB as the booking. Without that
 * check a stray id would let one client's truck be marked as going out
 * on another client's order — which is worse than no indicator at all,
 * because the yard would believe it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, salesOnly: true, email: true, isActive: true },
  })
  if (!user || !user.isActive) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!getPermissions({ role: user.role, salesOnly: user.salesOnly, email: user.email ?? undefined }).canCreateBooking) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'attaching an order to a unit is a sales action' },
      { status: 403 },
    )
  }

  const { id } = await params
  const body = (await req.json().catch(() => null)) as { orderId?: string | null } | null
  if (!body || !('orderId' in body)) {
    return NextResponse.json({ error: 'orderId required (null to detach)' }, { status: 400 })
  }

  const assignment = await prisma.bookingAssignment.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      asset: { select: { unitName: true } },
      bookingItem: { select: { booking: { select: { jobId: true } } } },
    },
  })
  if (!assignment) return NextResponse.json({ error: 'assignment not found' }, { status: 404 })

  const nextOrderId = body.orderId ?? null
  if (nextOrderId) {
    const order = await prisma.order.findUnique({
      where: { id: nextOrderId },
      select: { id: true, jobId: true, orderNumber: true },
    })
    if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
    if (order.jobId !== assignment.bookingItem.booking.jobId) {
      return NextResponse.json(
        { error: 'order-not-on-job', reason: 'that order belongs to a different job' },
        { status: 400 },
      )
    }
  }

  const updated = await prisma.bookingAssignment.update({
    where: { id },
    data: { orderId: nextOrderId },
    select: { id: true, order: { select: { id: true, orderNumber: true } } },
  })

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: nextOrderId ? 'assignment.order_attached' : 'assignment.order_detached',
      entityType: 'BookingAssignment',
      entityId: id,
      oldValues: { orderId: assignment.orderId },
      newValues: { orderId: nextOrderId, unitName: assignment.asset.unitName },
    },
  })

  return NextResponse.json({ ok: true, assignment: updated })
}
