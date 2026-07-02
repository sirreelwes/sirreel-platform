/**
 * /api/sub-rentals/[id]
 *
 *   GET    → single sub-rental with vendor + order + line
 *   PATCH  → edit Phase 1 fields (vendor, qty, dates, vendor* rates,
 *            receiveMethod, PO #, notes, status). Re-derives client*
 *            when quantity changes and orderLineItemId is set.
 *   DELETE → soft "cancel" via status=CANCELLED (no row removal —
 *            we keep the audit trail).
 *
 * PATCH + DELETE require Permissions.subRentals.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { Prisma, ReceiveMethod, SubRentalStatus } from '@prisma/client'
import { parseMoney } from '@/lib/pricing/resolveRate'
import { authOptions } from '@/lib/auth'
import { requireSubRentalAccess } from '@/lib/sub-rentals/auth'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const sr = await prisma.subRental.findUnique({
    where: { id: params.id },
    include: {
      vendor: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true } },
      orderLineItem: { select: { id: true, description: true, quantity: true, rate: true } },
    },
  })
  if (!sr) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(sr)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate

  const existing = await prisma.subRental.findUnique({
    where: { id: params.id },
    select: { id: true, orderLineItemId: true, quantity: true },
  })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = await req.json().catch(() => null) as {
    vendorId?: string
    receiveMethod?: 'PICKUP' | 'DELIVERY' | null
    itemDescription?: string
    quantity?: number
    startDate?: string | null
    endDate?: string | null
    vendorDailyRate?: number | null
    vendorWeeklyRate?: number | null
    vendorTotal?: number | null
    poNumber?: string | null
    notes?: string | null
    status?: SubRentalStatus
  } | null
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 })

  if (body.receiveMethod && !Object.values(ReceiveMethod).includes(body.receiveMethod as ReceiveMethod)) {
    return NextResponse.json({ error: 'invalid receiveMethod' }, { status: 400 })
  }
  if (body.status && !Object.values(SubRentalStatus).includes(body.status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  }

  // If quantity is changing and we're linked to a line, re-clamp +
  // re-derive client*. If not linked, just accept the new qty.
  let newQty = existing.quantity
  // Decimal-safe (audit §7): stay in Prisma.Decimal, no Number() bridge.
  let derivedClientDailyRate: Prisma.Decimal | null | undefined = undefined
  let derivedClientTotal: Prisma.Decimal | null | undefined = undefined
  if (typeof body.quantity === 'number') {
    newQty = Math.max(1, Math.floor(body.quantity))
    if (existing.orderLineItemId) {
      const line = await prisma.orderLineItem.findUnique({
        where: { id: existing.orderLineItemId },
        select: { rate: true, quantity: true },
      })
      if (line) {
        if (newQty > line.quantity) {
          return NextResponse.json(
            { error: `quantity ${newQty} exceeds line quantity ${line.quantity}` },
            { status: 400 },
          )
        }
        derivedClientDailyRate = line.rate
        derivedClientTotal = line.rate.times(newQty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      }
    }
  }

  const updated = await prisma.subRental.update({
    where: { id: params.id },
    data: {
      ...(body.vendorId !== undefined ? { vendorId: body.vendorId } : {}),
      ...(body.receiveMethod !== undefined ? { receiveMethod: body.receiveMethod as ReceiveMethod | null } : {}),
      ...(body.itemDescription !== undefined ? { itemDescription: body.itemDescription } : {}),
      ...(typeof body.quantity === 'number' ? { quantity: newQty } : {}),
      ...(body.startDate !== undefined ? { startDate: body.startDate ? new Date(body.startDate) : null } : {}),
      ...(body.endDate !== undefined ? { endDate: body.endDate ? new Date(body.endDate) : null } : {}),
      ...(body.vendorDailyRate !== undefined ? { vendorDailyRate: parseMoney(body.vendorDailyRate) } : {}),
      ...(body.vendorWeeklyRate !== undefined ? { vendorWeeklyRate: parseMoney(body.vendorWeeklyRate) } : {}),
      ...(body.vendorTotal !== undefined ? { vendorTotal: parseMoney(body.vendorTotal) } : {}),
      ...(body.poNumber !== undefined ? { poNumber: body.poNumber } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(derivedClientDailyRate !== undefined ? { clientDailyRate: derivedClientDailyRate } : {}),
      ...(derivedClientTotal !== undefined ? { clientTotal: derivedClientTotal } : {}),
    },
    include: {
      vendor: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true } },
      orderLineItem: { select: { id: true, description: true } },
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate
  // Soft-cancel — keep the row + audit trail. Use PATCH status=CANCELLED
  // for the same effect; this DELETE just sugar.
  const updated = await prisma.subRental.update({
    where: { id: params.id },
    data: { status: SubRentalStatus.CANCELLED },
  })
  return NextResponse.json({ ok: true, status: updated.status })
}
