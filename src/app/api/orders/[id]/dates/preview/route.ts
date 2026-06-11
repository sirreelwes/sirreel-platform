/**
 * POST /api/orders/[id]/dates/preview — preview a "push dates" change
 * without writing anything.
 *
 * Body:
 *   {
 *     startDate: string ISO,
 *     endDate:   string ISO,
 *     customItemActions?: { [lineItemId]: 'shift' | 'keep' }   // default 'keep'
 *   }
 *
 * Returns:
 *   {
 *     currentRange / newRange / offsetDays,
 *     projectedItems  — per-item old/new billable + lineTotal + classification
 *                       (inherited | custom_shifted | custom_kept),
 *     currentTotals / projectedTotals / delta,
 *     conflicts       — per-asset overlapping bookings in the new range
 *                       (excluding this order's own booking),
 *     postBooking     — true when status ∉ DRAFT/QUOTE_SENT, so the
 *                       caller knows the invoice will need adjustment,
 *   }
 *
 * Auth: getServerSession. Read-only — no writes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { computePushDatesPreview, type CustomItemAction, type PreviewLineItem } from '@/lib/orders/datePushPreview'
import { findAssetConflictsForRange } from '@/lib/scheduling/assetConflicts'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const PRE_BOOK_STATUSES = new Set(['DRAFT', 'QUOTE_SENT', 'APPROVED'])

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => null) as {
    startDate?: string
    endDate?: string
    customItemActions?: Record<string, CustomItemAction>
  } | null
  if (!body?.startDate || !body?.endDate) {
    return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 })
  }
  const newStart = new Date(body.startDate)
  const newEnd = new Date(body.endDate)
  if (!Number.isFinite(newStart.getTime()) || !Number.isFinite(newEnd.getTime())) {
    return NextResponse.json({ error: 'invalid date format' }, { status: 400 })
  }
  if (newEnd.getTime() <= newStart.getTime()) {
    return NextResponse.json({ error: 'endDate must be after startDate' }, { status: 400 })
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      taxRate: true,
      bookingId: true,
      lineItems: {
        select: {
          id: true,
          description: true,
          department: true,
          type: true,
          rateType: true,
          rate: true,
          quantity: true,
          startDate: true,
          endDate: true,
          pickupDate: true,
          returnDate: true,
          billableDays: true,
          lineTotal: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
      discounts: {
        select: {
          id: true,
          scope: true,
          departmentKey: true,
          type: true,
          value: true,
          label: true,
        },
      },
      booking: {
        select: {
          id: true,
          items: {
            select: {
              assignments: { select: { assetId: true } },
            },
          },
        },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  if (!order.startDate || !order.endDate) {
    return NextResponse.json(
      { error: 'order has no current date range to push from' },
      { status: 422 },
    )
  }

  const items: PreviewLineItem[] = order.lineItems.map((li) => ({
    id: li.id,
    description: li.description,
    department: li.department,
    type: li.type,
    rateType: li.rateType,
    rate: Number(li.rate),
    quantity: li.quantity,
    inheritsDates: li.startDate == null && li.endDate == null,
    startDate: li.startDate,
    endDate: li.endDate,
    pickupDate: li.pickupDate,
    returnDate: li.returnDate,
    billableDays: li.billableDays,
    lineTotal: Number(li.lineTotal),
  }))

  const preview = computePushDatesPreview({
    currentStartDate: order.startDate,
    currentEndDate: order.endDate,
    newStartDate: newStart,
    newEndDate: newEnd,
    items,
    customItemActions: body.customItemActions ?? {},
    discounts: order.discounts.map((d) => ({
      id: d.id,
      scope: d.scope,
      departmentKey: d.departmentKey,
      type: d.type,
      value: Number(d.value),
      label: d.label,
    })),
    taxRate: Number(order.taxRate),
  })

  // Asset conflicts — pull every asset currently assigned via this
  // order's booking and look for overlapping assignments on OTHER
  // bookings in the new range.
  const assetIds = order.booking
    ? Array.from(new Set(
        order.booking.items.flatMap((bi) => bi.assignments.map((a) => a.assetId)),
      ))
    : []
  const conflicts = await findAssetConflictsForRange({
    assetIds,
    startDate: newStart,
    endDate: newEnd,
    ignoreBookingId: order.bookingId,
  })

  const postBooking = !PRE_BOOK_STATUSES.has(order.status)

  return NextResponse.json({
    currentRange: preview.currentRange,
    newRange: preview.newRange,
    offsetDays: preview.offsetDays,
    projectedItems: preview.projectedItems,
    currentTotals: preview.currentTotals,
    projectedTotals: preview.projectedTotals,
    delta: preview.delta,
    conflicts,
    postBooking,
  })
}
