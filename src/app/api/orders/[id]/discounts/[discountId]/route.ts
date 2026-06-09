/**
 * PATCH  /api/orders/[id]/discounts/[discountId] — edit value / label /
 *                                                  type. Scope +
 *                                                  departmentKey are
 *                                                  immutable (changing
 *                                                  them is functionally
 *                                                  a delete + create).
 * DELETE /api/orders/[id]/discounts/[discountId] — remove.
 *
 * Both recompute Order.subtotal/taxAmount/total after the mutation so
 * the persisted columns stay in sync. Auth: getServerSession-guarded.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { DiscountType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recalcOrderTotals } from '@/lib/orders'

export const dynamic = 'force-dynamic'

const VALID_TYPES: DiscountType[] = ['PERCENT', 'FIXED']

type Params = { params: Promise<{ id: string; discountId: string }> }

async function requireUser() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
}

interface PatchBody {
  type?: unknown
  value?: unknown
  label?: unknown
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const me = await requireUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: orderId, discountId } = await params
  const body = (await req.json().catch(() => ({}))) as PatchBody

  const existing = await prisma.orderDiscount.findFirst({
    where: { id: discountId, orderId },
  })
  if (!existing) return NextResponse.json({ error: 'discount not found' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (body.type !== undefined) {
    if (typeof body.type !== 'string' || !(VALID_TYPES as string[]).includes(body.type)) {
      return NextResponse.json({ error: 'type must be PERCENT or FIXED' }, { status: 400 })
    }
    data.type = body.type as DiscountType
  }
  if (body.value !== undefined) {
    const n = typeof body.value === 'number' ? body.value : Number(body.value)
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: 'value must be a positive number' }, { status: 400 })
    }
    const effectiveType = (data.type as DiscountType | undefined) ?? existing.type
    if (effectiveType === 'PERCENT' && n > 100) {
      return NextResponse.json({ error: 'percent value must be ≤ 100' }, { status: 400 })
    }
    data.value = n
  }
  if (body.label !== undefined) {
    if (typeof body.label !== 'string') {
      return NextResponse.json({ error: 'label must be a string' }, { status: 400 })
    }
    const trimmed = body.label.trim().slice(0, 200)
    data.label = trimmed.length > 0 ? trimmed : 'Discount'
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const updated = await prisma.orderDiscount.update({
    where: { id: discountId },
    data,
  })
  await recalcOrderTotals(orderId)

  return NextResponse.json({
    ok: true,
    discount: { ...updated, value: Number(updated.value) },
  })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const me = await requireUser()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: orderId, discountId } = await params
  const existing = await prisma.orderDiscount.findFirst({
    where: { id: discountId, orderId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'discount not found' }, { status: 404 })

  await prisma.orderDiscount.delete({ where: { id: discountId } })
  await recalcOrderTotals(orderId)

  return NextResponse.json({ ok: true })
}
