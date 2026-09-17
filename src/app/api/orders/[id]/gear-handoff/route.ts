/**
 * PATCH /api/orders/[id]/gear-handoff
 *
 * How the NON-vehicle lines of an order leave the building — will call at
 * the warehouse, or loaded onto one of the vehicles RESERVED on the job.
 *
 * Wes 2026-09-16: "we need orders that are going on the vehicles (for
 * instance, production supplies and walkies) to be able to be notated at
 * the bottom of that order with where to load that order. It has to be
 * onto one of the vehicles that is reserved."
 *
 * The order builder asked this once at creation (from-parse); this is the
 * same answer, editable from the order page — and the LOAD_ON target is
 * checked, not trusted: it must be a live reservation (ASSIGNED or
 * CHECKED_OUT) on THIS order's job. A gear order on a job whose trucks
 * are on a sibling order (the common shape — vehicles quoted on one
 * order, the warehouse list on another) loads on that sibling's truck.
 *
 * Body: { handoff: 'WILL_CALL' | 'LOAD_ON' | null, assignmentId?: string }
 *   null clears the note ("not decided").
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { extractIp, resolveOperatorId } from '@/lib/orders/auditLineItemEdit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: orderId } = await params

  const body = (await req.json().catch(() => null)) as { handoff?: unknown; assignmentId?: unknown } | null
  if (!body || !('handoff' in body)) return NextResponse.json({ error: 'handoff required' }, { status: 400 })
  const handoff = body.handoff === 'WILL_CALL' || body.handoff === 'LOAD_ON' ? body.handoff : body.handoff === null ? null : undefined
  if (handoff === undefined) {
    return NextResponse.json({ error: 'invalid handoff', reason: "handoff must be 'WILL_CALL', 'LOAD_ON' or null" }, { status: 400 })
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, jobId: true, gearHandoff: true, gearLoadsOnAssignmentId: true },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  let assignmentId: string | null = null
  let unitName: string | null = null
  if (handoff === 'LOAD_ON') {
    const requested = typeof body.assignmentId === 'string' && body.assignmentId ? body.assignmentId : null
    if (!requested) {
      return NextResponse.json(
        { error: 'assignment required', reason: 'Say which reserved vehicle the gear loads on.' },
        { status: 400 },
      )
    }
    // Reserved, live, and on this job — the three things "one of the
    // vehicles that is reserved" means.
    const a = await prisma.bookingAssignment.findUnique({
      where: { id: requested },
      select: {
        id: true,
        status: true,
        asset: { select: { unitName: true } },
        bookingItem: { select: { booking: { select: { jobId: true, status: true, archivedAt: true } } } },
      },
    })
    if (!a) return NextResponse.json({ error: 'assignment not found' }, { status: 404 })
    const bk = a.bookingItem.booking
    if (a.status !== 'ASSIGNED' && a.status !== 'CHECKED_OUT') {
      return NextResponse.json(
        { error: 'not reserved', reason: `${a.asset.unitName} is no longer reserved on this job — pick a vehicle that is.` },
        { status: 409 },
      )
    }
    if (!order.jobId || bk.jobId !== order.jobId || bk.status === 'CANCELLED' || bk.archivedAt) {
      return NextResponse.json(
        { error: 'not on job', reason: `${a.asset.unitName} is not reserved on this order's job.` },
        { status: 409 },
      )
    }
    assignmentId = a.id
    unitName = a.asset.unitName
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { gearHandoff: handoff, gearLoadsOnAssignmentId: assignmentId },
    select: { id: true, gearHandoff: true, gearLoadsOnAssignmentId: true },
  })

  try {
    await prisma.auditLog.create({
      data: {
        userId: await resolveOperatorId(session.user.email),
        ipAddress: extractIp(req),
        action: 'order.gear_handoff_set',
        entityType: 'Order',
        entityId: orderId,
        oldValues: { gearHandoff: order.gearHandoff, gearLoadsOnAssignmentId: order.gearLoadsOnAssignmentId },
        newValues: { gearHandoff: handoff, gearLoadsOnAssignmentId: assignmentId, unit: unitName, orderNumber: order.orderNumber },
      },
    })
  } catch (err) {
    console.error('[gear-handoff] audit failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ ok: true, ...updated, unitName })
}
