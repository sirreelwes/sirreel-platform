/**
 * POST /api/orders/[id]/line-items/from-package
 *
 * Expand a Package into one header line + N member lines on the
 * order. Used by the order-detail modal's combobox when the rep
 * picks a PKG hit (the inline new-quote flow handles expansion in
 * client state; this endpoint is the post-create equivalent).
 *
 * Body:
 *   {
 *     packageId: string,
 *     pickupDate?, returnDate?, billableDays?    (defaults: order dates)
 *   }
 *
 * On success: 201 with the created line items array + recalc'd
 * totals. All inserts run in a single Prisma transaction; a partial
 * failure leaves the order's lines untouched.
 *
 * Auth: getServerSession + staff role.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { computeLineTotal } from '@/lib/orders/billing'
import { recalcOrderTotals } from '@/lib/orders'
import { randomUUID } from 'crypto'
import { LineItemDepartment, LineItemType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function computeRentalDays(pickup: Date, ret: Date): number {
  const ms = ret.getTime() - pickup.getTime()
  return Math.max(1, Math.ceil(ms / 86_400_000) + 1)
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: orderId } = await params
  const body = await req.json().catch(() => null) as {
    packageId?: string
    pickupDate?: string
    returnDate?: string
    billableDays?: number
  } | null
  if (!body?.packageId) return NextResponse.json({ error: 'packageId required' }, { status: 400 })

  const [order, pkg] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, startDate: true, endDate: true },
    }),
    prisma.package.findUnique({
      where: { id: body.packageId },
      include: {
        items: {
          include: { inventoryItem: { select: { id: true, code: true, description: true, department: true } } },
        },
      },
    }),
  ])
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  if (!pkg) return NextResponse.json({ error: 'package not found' }, { status: 404 })
  if (!pkg.active) return NextResponse.json({ error: 'package is inactive' }, { status: 400 })

  // Resolve dates.
  const pickupResolved = body.pickupDate
    ? new Date(body.pickupDate)
    : order.startDate ?? new Date()
  const returnResolved = body.returnDate
    ? new Date(body.returnDate)
    : order.endDate ?? pickupResolved
  const days =
    body.billableDays && body.billableDays > 0
      ? Math.floor(body.billableDays)
      : computeRentalDays(pickupResolved, returnResolved)

  const instanceId = randomUUID()

  const headerRate = Number(pkg.pricePerDay)
  const headerTotal = computeLineTotal({
    quantity: 1, rate: headerRate, billableDays: days, rateType: 'DAILY', department: pkg.department,
  })

  const maxSort = await prisma.orderLineItem.aggregate({
    where: { orderId },
    _max: { sortOrder: true },
  })
  let sortOrder = (maxSort._max.sortOrder ?? -1) + 1

  const lines = await prisma.$transaction(async (tx) => {
    const header = await tx.orderLineItem.create({
      data: {
        orderId,
        sortOrder: sortOrder++,
        type: LineItemType.EQUIPMENT,
        description: pkg.name,
        department: pkg.department as LineItemDepartment,
        rateType: 'DAILY',
        rate: headerRate,
        quantity: 1,
        pickupDate: pickupResolved,
        returnDate: returnResolved,
        billableDays: days,
        lineTotal: Math.round(headerTotal * 100) / 100,
        packageInstanceId: instanceId,
        packageId: pkg.id,
        isPackageHeader: true,
        isPackageModified: false,
      },
    })
    const members = []
    for (const it of pkg.items) {
      const memberType =
        it.inventoryItem.department === 'EXPENDABLES' ? LineItemType.EXPENDABLE : LineItemType.EQUIPMENT
      const member = await tx.orderLineItem.create({
        data: {
          orderId,
          sortOrder: sortOrder++,
          type: memberType,
          description: it.inventoryItem.description || it.inventoryItem.code,
          department: it.inventoryItem.department,
          inventoryItemId: it.inventoryItem.id,
          rateType: 'DAILY',
          rate: 0,
          quantity: it.qty,
          pickupDate: pickupResolved,
          returnDate: returnResolved,
          billableDays: days,
          lineTotal: 0,
          packageInstanceId: instanceId,
          packageId: pkg.id,
          isPackageHeader: false,
          isPackageModified: false,
        },
      })
      members.push(member)
    }
    return [header, ...members]
  })

  const totals = await recalcOrderTotals(orderId)
  return NextResponse.json({ lines, totals, packageInstanceId: instanceId }, { status: 201 })
}
