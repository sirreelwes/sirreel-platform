/**
 * /api/sub-rentals
 *
 *   GET  ?status=&orderId=&orderLineItemId=  → list (with vendor + order + line)
 *   POST                                      → create one (Phase 1)
 *
 * Auth:
 *   - GET allows any authenticated session (the data is internal but
 *     not write-sensitive; the nav itself is gated).
 *   - POST requires Permissions.subRentals (AGENT + MANAGER + ADMIN
 *     in Phase 1; see src/lib/sub-rentals/auth.ts).
 *
 * Money:
 *   - vendor* fields (what SirReel pays the vendor) come from the
 *     caller as entered in the modal.
 *   - client* fields are derived from the order line on the server
 *     when orderLineItemId is supplied: clientDailyRate = line.rate
 *     (as DAILY) and clientTotal = line.rate * quantity. The caller
 *     CAN'T override client* — single source of truth is the line
 *     rate the client already saw on the quote.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { SubRentalStatus, ReceiveMethod } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { requireSubRentalAccess } from '@/lib/sub-rentals/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const orderId = searchParams.get('orderId')
  const orderLineItemId = searchParams.get('orderLineItemId')

  const where: Record<string, unknown> = {}
  if (status && Object.values(SubRentalStatus).includes(status as SubRentalStatus)) {
    where.status = status as SubRentalStatus
  }
  if (orderId) where.orderId = orderId
  if (orderLineItemId) where.orderLineItemId = orderLineItemId

  const subRentals = await prisma.subRental.findMany({
    where,
    include: {
      vendor: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true, description: true } },
      orderLineItem: { select: { id: true, description: true, quantity: true, rate: true } },
      inventoryItem: { select: { id: true, code: true, description: true } },
    },
    orderBy: [{ status: 'asc' }, { endDate: 'asc' }, { createdAt: 'desc' }],
  })

  return NextResponse.json({ subRentals })
}

export async function POST(req: NextRequest) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => null) as {
    orderId?: string | null
    orderLineItemId?: string | null
    inventoryItemId?: string | null
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
  } | null

  if (!body || !body.vendorId || !body.itemDescription) {
    return NextResponse.json(
      { error: 'vendorId and itemDescription are required' },
      { status: 400 },
    )
  }

  // Validate receiveMethod against the enum so a typo doesn't land in
  // the DB as an opaque string error from Prisma.
  if (body.receiveMethod && !Object.values(ReceiveMethod).includes(body.receiveMethod as ReceiveMethod)) {
    return NextResponse.json({ error: 'invalid receiveMethod' }, { status: 400 })
  }

  // If the caller wired orderLineItemId, derive client* from the line
  // and clamp quantity ≤ line.quantity (partial fulfillment is fine,
  // over-allocation is a bug). Also infer orderId from the line so we
  // don't depend on the caller to pass both.
  let derivedClientDailyRate: number | null = null
  let derivedClientTotal: number | null = null
  let resolvedOrderId: string | null = body.orderId ?? null
  let qty = Math.max(1, Math.floor(body.quantity ?? 1))

  if (body.orderLineItemId) {
    const line = await prisma.orderLineItem.findUnique({
      where: { id: body.orderLineItemId },
      select: { id: true, orderId: true, rate: true, quantity: true, description: true },
    })
    if (!line) {
      return NextResponse.json({ error: 'orderLineItemId not found' }, { status: 404 })
    }
    if (qty > line.quantity) {
      return NextResponse.json(
        { error: `quantity ${qty} exceeds line quantity ${line.quantity}` },
        { status: 400 },
      )
    }
    resolvedOrderId = line.orderId
    derivedClientDailyRate = Number(line.rate)
    derivedClientTotal = Number(line.rate) * qty
  }

  const subRental = await prisma.subRental.create({
    data: {
      orderId: resolvedOrderId,
      orderLineItemId: body.orderLineItemId ?? null,
      inventoryItemId: body.inventoryItemId ?? null,
      vendorId: body.vendorId,
      receiveMethod: body.receiveMethod as ReceiveMethod | undefined,
      itemDescription: body.itemDescription,
      quantity: qty,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      vendorDailyRate: body.vendorDailyRate ?? null,
      vendorWeeklyRate: body.vendorWeeklyRate ?? null,
      vendorTotal: body.vendorTotal ?? null,
      // Server-derived from the line — never accepted from caller.
      clientDailyRate: derivedClientDailyRate,
      clientWeeklyRate: null,
      clientTotal: derivedClientTotal,
      poNumber: body.poNumber ?? null,
      notes: body.notes ?? null,
    },
    include: {
      vendor: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true } },
      orderLineItem: { select: { id: true, description: true } },
    },
  })

  return NextResponse.json(subRental, { status: 201 })
}
