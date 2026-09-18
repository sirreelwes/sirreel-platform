/**
 * POST /api/orders/[id]/standing-deals/apply — put ONE of the client's
 * standing department deals on this order.
 *
 * Body: { dealId } — a CompanyDiscount id belonging to this order's client.
 *
 * ── Why this is not the general discounts POST
 *
 * That route runs `gateFurtherDiscount`, which refuses a non-ADMIN any new
 * discount on an account that HAS standing deals. Which is every account
 * this button can appear on: the whole premise is that the client has a
 * deal the order is missing. A rep pressing "Apply it" would be told to go
 * ask Wes for permission to give the client the discount Wes already
 * agreed to.
 *
 * The gate is right about what it guards — stacking a FURTHER concession
 * on top of a negotiated one. This is the opposite act, and what makes
 * skipping the gate safe is that the figure is not the caller's: the
 * percent and the label are read off the CompanyDiscount row, the body
 * carries an id and nothing else, so there is no number for a rep to
 * inflate. Change that and the gate has to come back.
 *
 * Everything else the discounts route enforces still applies here — the
 * money-editable window, one row per department, the partner floor, the
 * totals recalc and the audit trail — because those guard the ORDER, not
 * the rep's discretion.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { recalcOrderTotals } from '@/lib/orders'
import { isMoneyEditable } from '@/lib/orders/editability'
import { isDiscountableDepartment } from '@/lib/orders/discountedTotals'
import { auditLineItemEdit, extractIp } from '@/lib/orders/auditLineItemEdit'
import { partnerFloorGate } from '@/lib/sub-rentals/partnerMargins'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: orderId } = await params
  const body = (await req.json().catch(() => ({}))) as { dealId?: unknown }
  const dealId = typeof body.dealId === 'string' ? body.dealId.trim() : ''
  if (!dealId) return NextResponse.json({ error: 'dealId required' }, { status: 400 })

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, companyId: true },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  if (!isMoneyEditable(order.status)) {
    return NextResponse.json(
      {
        error: 'discount edit not permitted',
        reason: `order is ${order.status} — locked to reopen/credit only`,
      },
      { status: 409 },
    )
  }

  // The deal is re-read and re-validated here rather than trusted from the
  // panel: the page may have been open since before it lapsed, or since
  // the job's production company changed under it.
  const now = new Date()
  const deal = await prisma.companyDiscount.findFirst({
    where: {
      id: dealId,
      companyId: order.companyId ?? '',
      isActive: true,
      departmentKey: { not: null },
      AND: [
        { OR: [{ effectiveDate: null }, { effectiveDate: { lte: now } }] },
        { OR: [{ expiryDate: null }, { expiryDate: { gte: now } }] },
      ],
    },
    select: { id: true, label: true, percentOff: true, departmentKey: true },
  })
  if (!deal || !deal.departmentKey) {
    return NextResponse.json(
      { error: 'That deal is no longer on this client, or is not a department deal.' },
      { status: 404 },
    )
  }
  if (deal.percentOff <= 0 || deal.percentOff > 100) {
    return NextResponse.json({ error: 'That deal has an unusable percentage.' }, { status: 409 })
  }
  // Same refusal the discounts route makes out loud — computeOrderTotals
  // skips the department, so the row would be a discount the client is
  // shown and never gets.
  if (!isDiscountableDepartment(deal.departmentKey)) {
    return NextResponse.json(
      {
        error: 'department not discountable',
        reason: 'Expendables are a sale, not a rental — they’re passed through at cost and carry no discount.',
      },
      { status: 400 },
    )
  }

  const existing = await prisma.orderDiscount.findFirst({
    where: { orderId, scope: 'DEPARTMENT', departmentKey: deal.departmentKey },
    select: { id: true, label: true },
  })
  if (existing) {
    return NextResponse.json(
      {
        error: `A discount on ${deal.departmentKey} is already on this order ("${existing.label}").`,
        existingId: existing.id,
      },
      { status: 409 },
    )
  }

  // A partner's unit: shared with them up to their maximum, then out of
  // SirReel's share, never below the floor. No override anywhere — not
  // even for a deal the client negotiated.
  const floor = await partnerFloorGate(orderId, {
    discount: {
      next: {
        scope: 'DEPARTMENT',
        departmentKey: deal.departmentKey,
        type: 'PERCENT',
        value: deal.percentOff,
        label: deal.label,
      },
    },
  })
  if (!floor.ok) {
    return NextResponse.json({ error: floor.message, reason: floor.message }, { status: 409 })
  }

  const created = await prisma.orderDiscount.create({
    data: {
      orderId,
      scope: 'DEPARTMENT',
      departmentKey: deal.departmentKey,
      type: 'PERCENT',
      value: deal.percentOff,
      // The client-facing label the deal was agreed under — the same one
      // applyStandingDiscounts seeds at order create, so an order that got
      // it automatically and one that got it from this button read
      // identically on the quote.
      label: deal.label,
      createdById: me.id,
    },
  })
  await recalcOrderTotals(orderId)

  await auditLineItemEdit({
    orderId,
    orderStatus: order.status,
    action: 'order.discount_added',
    oldValues: null,
    newValues: {
      discountId: created.id,
      scope: created.scope,
      departmentKey: created.departmentKey,
      type: created.type,
      value: created.value.toString(),
      label: created.label,
      // What separates this row from a rep's own: it came off a standing
      // deal, and the audit says which one.
      standingDealId: deal.id,
    },
    userId: me.id,
    ipAddress: extractIp(req),
  })

  return NextResponse.json({
    ok: true,
    discount: {
      id: created.id,
      departmentKey: created.departmentKey,
      value: Number(created.value),
      label: created.label,
    },
  })
}
