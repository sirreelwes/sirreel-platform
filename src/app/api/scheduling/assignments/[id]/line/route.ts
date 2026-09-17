/**
 * PATCH /api/scheduling/assignments/[id]/line — say which ORDER LINE this
 * reserved truck is for (or take the stamp off).
 *
 * Wes, 2026-09-17, on Index Films: "we have two cube trucks on two orders
 * in that job — both cube trucks on the order says there is not a unit
 * assigned even though it's on reservations."
 *
 * The booking is job-level, so two orders quoting a Cube Truck share ONE
 * hold, and `assignUnitToBookingItem` refuses to guess which order a truck
 * picked on the BOARD belongs to when the job carries more than one live
 * order — it leaves `orderId` and `orderLineItemId` null. Correct: a wrong
 * stamp prints the wrong unit on a quote and releases the wrong truck
 * later. But until now there was no way to answer the question afterwards
 * either, so both order lines read "Held · no unit" forever while the
 * trucks sat on the reservation. This is that answer.
 *
 * Sibling of `[id]/order/route.ts`, which sets the order marker alone.
 * A line implies its order, so attaching here sets BOTH.
 *
 * SALES action, same gate as every other unit-assignment control:
 * canCreateBooking (AGENT / MANAGER / ADMIN).
 *
 * Three checks, each guarding a way the stamp could lie:
 *   · the line's order is on the assignment's JOB — otherwise one
 *     client's truck could be marked as going out on another's order;
 *   · the line holds the SAME CLASS as the hold the truck stands on —
 *     a Cube Truck must not print on a cargo-van line;
 *   · the truck is not already another line's — that one is claimed, and
 *     silently moving it would empty a row somebody else is reading.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'
import { holdCategoryIdForLine, LIVE_ASSIGNMENT_STATUSES } from '@/lib/orders/lineUnits'

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
      { error: 'forbidden', reason: 'attaching a unit to an order line is a sales action' },
      { status: 403 },
    )
  }

  const { id } = await params
  const body = (await req.json().catch(() => null)) as { orderLineItemId?: string | null } | null
  if (!body || !('orderLineItemId' in body)) {
    return NextResponse.json({ error: 'orderLineItemId required (null to detach)' }, { status: 400 })
  }

  const assignment = await prisma.bookingAssignment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      orderId: true,
      orderLineItemId: true,
      asset: { select: { unitName: true } },
      bookingItem: { select: { categoryId: true, booking: { select: { jobId: true } } } },
    },
  })
  if (!assignment) return NextResponse.json({ error: 'assignment not found' }, { status: 404 })
  if (!(LIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(assignment.status)) {
    return NextResponse.json(
      { error: 'not-live', reason: 'that unit is no longer on the reservation' },
      { status: 409 },
    )
  }

  const nextLineId = body.orderLineItemId ?? null

  // ── Detach ────────────────────────────────────────────────────────
  // The order marker is a DIFFERENT fact (Hugo's "Order attached"
  // indicator for the yard) and is left exactly as it was — clearing it
  // is what PATCH …/order is for.
  if (!nextLineId) {
    await prisma.bookingAssignment.update({ where: { id }, data: { orderLineItemId: null } })
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'assignment.line_detached',
        entityType: 'BookingAssignment',
        entityId: id,
        oldValues: { orderLineItemId: assignment.orderLineItemId },
        newValues: { orderLineItemId: null, unitName: assignment.asset.unitName },
      },
    })
    return NextResponse.json({ ok: true, assignment: { id, orderLineItemId: null } })
  }

  if (assignment.orderLineItemId && assignment.orderLineItemId !== nextLineId) {
    return NextResponse.json(
      {
        error: 'already-claimed',
        reason: `${assignment.asset.unitName} is already reserved for another line — take it off that line first`,
      },
      { status: 409 },
    )
  }

  const line = await prisma.orderLineItem.findUnique({
    where: { id: nextLineId },
    select: {
      id: true,
      description: true,
      department: true,
      assetCategoryId: true,
      inventoryItemId: true,
      order: { select: { id: true, jobId: true, orderNumber: true } },
    },
  })
  if (!line) return NextResponse.json({ error: 'line not found' }, { status: 404 })
  if (!line.order || line.order.jobId !== assignment.bookingItem.booking.jobId) {
    return NextResponse.json(
      { error: 'line-not-on-job', reason: 'that order line belongs to a different job' },
      { status: 400 },
    )
  }

  // The class has to agree, or the row prints a Cube Truck on a cargo-van
  // line. `holdCategoryIdForLine` is the same resolution the hold itself
  // uses — a catalog-bound line carries no assetCategoryId of its own.
  const lineCategoryId = await holdCategoryIdForLine({
    department: line.department ?? '',
    assetCategoryId: line.assetCategoryId,
    inventoryItemId: line.inventoryItemId,
  })
  if (!lineCategoryId || lineCategoryId !== assignment.bookingItem.categoryId) {
    return NextResponse.json(
      {
        error: 'class-mismatch',
        reason: `${assignment.asset.unitName} is not the class this line holds — use Switch class to change the vehicle type`,
      },
      { status: 400 },
    )
  }

  const updated = await prisma.bookingAssignment.update({
    where: { id },
    // A line implies its order, so the yard's marker follows the stamp.
    data: { orderLineItemId: nextLineId, orderId: line.order.id },
    select: {
      id: true,
      orderLineItemId: true,
      order: { select: { id: true, orderNumber: true } },
      asset: { select: { unitName: true } },
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'assignment.line_attached',
      entityType: 'BookingAssignment',
      entityId: id,
      oldValues: { orderId: assignment.orderId, orderLineItemId: assignment.orderLineItemId },
      newValues: {
        orderId: line.order.id,
        orderNumber: line.order.orderNumber,
        orderLineItemId: nextLineId,
        lineDescription: line.description,
        unitName: assignment.asset.unitName,
      },
    },
  })

  return NextResponse.json({ ok: true, assignment: updated })
}
