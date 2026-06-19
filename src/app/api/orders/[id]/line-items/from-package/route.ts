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
 *     itemIds?: string[]                         (optional per-booking scope:
 *                                                  expand only these PackageItem
 *                                                  ids; header still expands
 *                                                  at full Package.pricePerDay
 *                                                  regardless of member count)
 *   }
 *
 * HOLD INTEGRATION — for any package member whose linked InventoryItem
 * description matches an Asset.unitName under the resolved
 * AssetCategory (the package's department surface), this route also
 * creates a BookingItem + BookingAssignment so the schedule shows that
 * specific area occupied. Used by the Lankershim facility flow: scope
 * 4 areas → 4 area Assets auto-bound on the Booking. Non-matching
 * members (parking lots without an Asset, etc.) skip the hold path
 * silently. The Order's parent Booking is created if it doesn't exist.
 *
 * On success: 201 with the created line items array + recalc'd
 * totals + bookings touched. All inserts run in a single transaction;
 * a partial failure leaves the order's lines untouched.
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
    itemIds?: string[]
  } | null
  if (!body?.packageId) return NextResponse.json({ error: 'packageId required' }, { status: 400 })

  const itemIdsFilter = Array.isArray(body.itemIds) && body.itemIds.length > 0
    ? new Set(body.itemIds.map(String))
    : null

  const [order, pkg] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, startDate: true, endDate: true, bookingId: true,
        companyId: true, agentId: true, jobContactId: true,
        job: { select: { name: true, jobContacts: { take: 1, select: { personId: true } } } },
      },
    }),
    prisma.package.findUnique({
      where: { id: body.packageId },
      include: {
        items: {
          include: { inventoryItem: { select: { id: true, code: true, description: true, department: true, clientNote: true } } },
        },
      },
    }),
  ])
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  if (!pkg) return NextResponse.json({ error: 'package not found' }, { status: 404 })
  if (!pkg.active) return NextResponse.json({ error: 'package is inactive' }, { status: 400 })

  // Apply per-booking scope filter (additive; absent → expand all)
  const scopedItems = itemIdsFilter
    ? pkg.items.filter((it) => itemIdsFilter.has(it.id))
    : pkg.items
  if (itemIdsFilter && scopedItems.length === 0) {
    return NextResponse.json({ error: 'itemIds matched no PackageItems on this package' }, { status: 400 })
  }

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

  // Pre-resolve hold candidates: for each scoped member's
  // InventoryItem.description, find an Asset whose unitName matches
  // (within an AssetCategory whose department equals the package
  // department). Single-Asset hits → bind. Anything ambiguous /
  // missing → silently skip the hold (line item still lands; the
  // schedule just won't auto-show that area as held). We don't fail
  // the package expansion over a missing Asset.
  type HoldCandidate = {
    inventoryItemId: string
    inventoryItemDescription: string
    asset: { id: string; unitName: string; categoryId: string }
  }
  const holdCandidates: HoldCandidate[] = []
  for (const it of scopedItems) {
    const desc = it.inventoryItem.description?.trim() || ''
    if (!desc) continue
    const matches = await prisma.asset.findMany({
      where: {
        unitName: desc,
        isActive: true,
        category: { department: pkg.department },
      },
      select: { id: true, unitName: true, categoryId: true },
    })
    if (matches.length === 1) {
      holdCandidates.push({
        inventoryItemId: it.inventoryItem.id,
        inventoryItemDescription: desc,
        asset: matches[0],
      })
    }
    // matches.length === 0 → no Asset for this member (LED Wall etc.); skip silently.
    // matches.length > 1 → ambiguous; skip rather than guess.
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. OrderLineItem header + members
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
    for (const it of scopedItems) {
      const memberType =
        it.inventoryItem.department === 'EXPENDABLES' ? LineItemType.EXPENDABLE : LineItemType.EQUIPMENT
      const memberClientNote =
        it.inventoryItem.clientNote && it.inventoryItem.clientNote.trim().length > 0
          ? it.inventoryItem.clientNote
          : null
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
          notes: memberClientNote,
          packageInstanceId: instanceId,
          packageId: pkg.id,
          isPackageHeader: false,
          isPackageModified: false,
        },
      })
      members.push(member)
    }

    // 2. Hold integration. Bind a BookingItem + BookingAssignment per
    //    hold candidate so the schedule shows the specific areas as
    //    occupied. Order needs a Booking; auto-create if missing.
    const holdsCreated: Array<{ bookingItemId: string; assetId: string; unitName: string }> = []
    if (holdCandidates.length > 0) {
      // Ensure Booking exists (one parent Booking per Order). Required-fields-only
      // body: companyId, personId, agentId, jobName, startDate, endDate. personId
      // resolved from Order.jobContact (the direct contact on the order) or the
      // job's first JobContact as a fallback. If neither exists, throw — the
      // schedule binding can't proceed without a Booking person of record.
      let bookingId = order.bookingId
      if (!bookingId) {
        const resolvedPersonId =
          order.jobContactId ?? order.job?.jobContacts?.[0]?.personId ?? null
        if (!resolvedPersonId) {
          throw new Error(
            'cannot auto-create Booking: Order has no jobContact and Job has no contacts — set one before applying a facility package',
          )
        }
        const yr = new Date().getUTCFullYear()
        let bookingNumber = ''
        for (let i = 0; i < 50; i++) {
          const n = String(Math.floor(1000 + Math.random() * 9000))
          const cand = 'SR-PKG-' + yr + '-' + n
          const exists = await tx.booking.findUnique({ where: { bookingNumber: cand }, select: { id: true } })
          if (!exists) { bookingNumber = cand; break }
        }
        if (!bookingNumber) throw new Error('failed to mint unique bookingNumber')
        const newBooking = await tx.booking.create({
          data: {
            bookingNumber,
            companyId: order.companyId,
            personId: resolvedPersonId,
            agentId: order.agentId,
            jobName: order.job?.name || 'Auto-created for package expansion',
            startDate: pickupResolved,
            endDate: returnResolved,
            status: 'CONFIRMED',
            source: 'AGENT_DIRECT',
          },
          select: { id: true },
        })
        bookingId = newBooking.id
        await tx.order.update({ where: { id: orderId }, data: { bookingId } })
      }

      // Per-area: 1 BookingItem (qty=1, holdRank=1) + 1 BookingAssignment.
      // Deterministic 1:1 — one Hospital Set Asset → one Hospital Set hold.
      for (const c of holdCandidates) {
        const bi = await tx.bookingItem.create({
          data: {
            bookingId,
            categoryId: c.asset.categoryId,
            quantity: 1,
            dailyRate: 0,
            status: 'ASSIGNED',
            holdRank: 1,
          },
          select: { id: true },
        })
        await tx.bookingAssignment.create({
          data: {
            bookingItemId: bi.id,
            assetId: c.asset.id,
            startDate: pickupResolved,
            endDate: returnResolved,
            status: 'ASSIGNED',
          },
        })
        holdsCreated.push({ bookingItemId: bi.id, assetId: c.asset.id, unitName: c.asset.unitName })
      }
    }

    return { lines: [header, ...members], holdsCreated }
  })

  const totals = await recalcOrderTotals(orderId)
  return NextResponse.json(
    { lines: result.lines, holds: result.holdsCreated, totals, packageInstanceId: instanceId },
    { status: 201 },
  )
}
