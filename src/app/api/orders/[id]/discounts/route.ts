/**
 * GET    /api/orders/[id]/discounts  — list discounts on an order
 *                                       plus the current totals breakdown
 *                                       so the UI can render from one
 *                                       source of truth.
 * POST   /api/orders/[id]/discounts  — create a discount (ORDER or
 *                                       DEPARTMENT scope).
 *
 * App-layer uniqueness enforced here (no partial unique index in the
 * schema): one ORDER-scope row per order, one row per
 * (orderId, departmentKey). 409 on duplicate.
 *
 * After every mutation, recalcOrderTotals() is called so
 * Order.subtotal / taxAmount / total reflect the discount-aware math
 * persisted to disk — the order detail UI and the daily totals
 * surfaces read those columns and would otherwise drift until the next
 * line-item edit.
 *
 * Auth: getServerSession-guarded; the discount creator is stamped on
 * the row for audit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { DiscountScope, DiscountType, LineItemDepartment } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recalcOrderTotals } from '@/lib/orders'
import { computeOrderTotals } from '@/lib/orders/discountedTotals'

export const dynamic = 'force-dynamic'

const VALID_SCOPES: DiscountScope[] = ['ORDER', 'DEPARTMENT']
const VALID_TYPES: DiscountType[] = ['PERCENT', 'FIXED', 'FLAT_TOTAL']
const VALID_DEPTS: LineItemDepartment[] = [
  'VEHICLES', 'COMMUNICATIONS', 'STAGES', 'PRO_SUPPLIES', 'EXPENDABLES', 'GE', 'ART',
]

type Params = { params: Promise<{ id: string }> }

async function requireUser() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
}

export async function GET(_req: NextRequest, { params }: Params) {
  const me = await requireUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const [order, lineItems, discounts] = await Promise.all([
    prisma.order.findUnique({ where: { id }, select: { id: true, taxRate: true } }),
    prisma.orderLineItem.findMany({
      where: { orderId: id },
      select: { department: true, type: true, lineTotal: true },
    }),
    prisma.orderDiscount.findMany({
      where: { orderId: id },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  const breakdown = computeOrderTotals({
    lines: lineItems.map((l) => ({ department: l.department, type: l.type, lineTotal: Number(l.lineTotal) })),
    discounts: discounts.map((d) => ({
      id: d.id, scope: d.scope, departmentKey: d.departmentKey,
      type: d.type, value: Number(d.value), label: d.label,
    })),
    taxRate: Number(order.taxRate),
  })

  return NextResponse.json({
    discounts: discounts.map((d) => ({
      ...d,
      value: Number(d.value),
    })),
    breakdown,
  })
}

interface CreateBody {
  scope?: unknown
  departmentKey?: unknown
  type?: unknown
  value?: unknown
  label?: unknown
}

export async function POST(req: NextRequest, { params }: Params) {
  const me = await requireUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: orderId } = await params
  const body = (await req.json().catch(() => ({}))) as CreateBody

  // ── Validation
  const scope = typeof body.scope === 'string' && (VALID_SCOPES as string[]).includes(body.scope)
    ? (body.scope as DiscountScope) : null
  if (!scope) return NextResponse.json({ error: 'scope must be ORDER or DEPARTMENT' }, { status: 400 })

  const type = typeof body.type === 'string' && (VALID_TYPES as string[]).includes(body.type)
    ? (body.type as DiscountType) : null
  if (!type) return NextResponse.json({ error: 'type must be PERCENT or FIXED' }, { status: 400 })

  const valueNum = typeof body.value === 'number' ? body.value
    : typeof body.value === 'string' ? Number(body.value) : NaN
  if (!Number.isFinite(valueNum) || valueNum <= 0) {
    return NextResponse.json({ error: 'value must be a positive number' }, { status: 400 })
  }
  if (type === 'PERCENT' && valueNum > 100) {
    return NextResponse.json({ error: 'percent value must be ≤ 100' }, { status: 400 })
  }
  // FLAT_TOTAL is the live-pinned target grand total — only meaningful
  // at the ORDER scope. Department-scope flat-total still funnels into
  // FIXED at the form layer (deptSubtotal is pre-tax, conversion is
  // exact, no markup risk on later edits — same not-pinned semantics).
  if (type === 'FLAT_TOTAL' && scope !== 'ORDER') {
    return NextResponse.json(
      { error: 'FLAT_TOTAL discount is ORDER scope only' },
      { status: 400 },
    )
  }

  let departmentKey: LineItemDepartment | null = null
  if (scope === 'DEPARTMENT') {
    if (typeof body.departmentKey !== 'string' || !(VALID_DEPTS as string[]).includes(body.departmentKey)) {
      return NextResponse.json({ error: 'departmentKey required for DEPARTMENT scope' }, { status: 400 })
    }
    departmentKey = body.departmentKey as LineItemDepartment
  } else if (body.departmentKey != null && body.departmentKey !== '') {
    return NextResponse.json({ error: 'departmentKey must be null for ORDER scope' }, { status: 400 })
  }

  const label = typeof body.label === 'string' && body.label.trim().length > 0
    ? body.label.trim().slice(0, 200)
    : 'Discount'

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  // ── App-layer uniqueness: max one ORDER, max one per departmentKey.
  const existingDup = await prisma.orderDiscount.findFirst({
    where: scope === 'ORDER'
      ? { orderId, scope: 'ORDER' }
      : { orderId, scope: 'DEPARTMENT', departmentKey },
    select: { id: true },
  })
  if (existingDup) {
    return NextResponse.json(
      {
        error: scope === 'ORDER'
          ? 'an order-scope discount already exists on this order'
          : `a discount on ${departmentKey} already exists on this order`,
        existingId: existingDup.id,
      },
      { status: 409 },
    )
  }

  const created = await prisma.orderDiscount.create({
    data: {
      orderId,
      scope,
      departmentKey,
      type,
      value: valueNum,
      label,
      createdById: me.id,
    },
  })
  // Cascade to Order.subtotal/taxAmount/total via the discount-aware util.
  await recalcOrderTotals(orderId)

  return NextResponse.json(
    { ok: true, discount: { ...created, value: Number(created.value) } },
    { status: 201 },
  )
}
