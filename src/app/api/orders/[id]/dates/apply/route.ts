/**
 * POST /api/orders/[id]/dates/apply — apply a "push dates" change.
 *
 * Body:
 *   {
 *     startDate: string ISO,
 *     endDate:   string ISO,
 *     customItemActions?: { [lineItemId]: 'shift' | 'keep' },
 *     overrideConflicts?: boolean    // required true when conflicts exist
 *   }
 *
 * Re-runs the preview server-side as the source of truth — never
 * trusts client-submitted projected values. Refuses with 409 if
 * conflicts exist and overrideConflicts is not true.
 *
 * On confirm (single transaction):
 *   1. Order.startDate / endDate updated.
 *   2. Inherited items: pickupDate / returnDate / billableDays
 *      updated; lineTotal recomputed.
 *   3. Custom items with action='shift': startDate / endDate / pickup /
 *      return all shifted by the offset; billableDays and lineTotal
 *      recomputed off the new custom range.
 *   4. Custom items with action='keep': untouched.
 *
 * After commit (outside the transaction so a side-effect hiccup can't
 * roll back the data write):
 *   - recalcOrderTotals(id) — persists Order.subtotal/taxAmount/total.
 *   - rebaselineCadenceForOrder(id) — clears unfired events, reseeds
 *     against new dates.
 *   - AuditLog row: action='order.dates_pushed', oldValues/newValues
 *     capture the before/after for the timeline.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { computePushDatesPreview, type CustomItemAction, type PreviewLineItem } from '@/lib/orders/datePushPreview'
import { findAssetConflictsForRange } from '@/lib/scheduling/assetConflicts'
import { recalcOrderTotals } from '@/lib/orders'
import { rebaselineCadenceForOrder } from '@/lib/cadence/scheduler'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const PRE_BOOK_STATUSES = new Set(['DRAFT', 'QUOTE_SENT', 'APPROVED'])

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null) as {
    startDate?: string
    endDate?: string
    customItemActions?: Record<string, CustomItemAction>
    overrideConflicts?: boolean
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
        select: { id: true, scope: true, departmentKey: true, type: true, value: true, label: true },
      },
      booking: {
        select: {
          id: true,
          items: { select: { assignments: { select: { assetId: true } } } },
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

  // Conflict gate.
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
  if (conflicts.length > 0 && !body.overrideConflicts) {
    return NextResponse.json(
      {
        error: 'asset conflicts in new range — pass overrideConflicts: true to proceed',
        conflicts,
      },
      { status: 409 },
    )
  }

  const oldStart = order.startDate
  const oldEnd = order.endDate

  // Single transaction: order date update + per-item updates.
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id },
      data: { startDate: newStart, endDate: newEnd },
    })
    for (const pi of preview.projectedItems) {
      if (pi.classification === 'custom_kept') continue
      await tx.orderLineItem.update({
        where: { id: pi.id },
        data: {
          startDate: pi.startDate,
          endDate: pi.endDate,
          pickupDate: pi.pickupDate,
          returnDate: pi.returnDate,
          billableDays: pi.billableDaysNew,
          lineTotal: pi.lineTotalNew,
        },
      })
    }
  })

  // Side-effects.
  try {
    await recalcOrderTotals(id)
  } catch (err) {
    console.error('[orders/dates/apply] recalcOrderTotals failed:', err)
  }
  try {
    await rebaselineCadenceForOrder(id)
  } catch (err) {
    console.error('[orders/dates/apply] cadence rebaseline failed:', err)
  }
  try {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'order.dates_pushed',
        entityType: 'order',
        entityId: id,
        oldValues: {
          startDate: oldStart.toISOString(),
          endDate: oldEnd.toISOString(),
        },
        newValues: {
          startDate: newStart.toISOString(),
          endDate: newEnd.toISOString(),
          customItemActions: body.customItemActions ?? {},
          shiftedItems: preview.projectedItems.filter((p) => p.classification === 'custom_shifted').map((p) => p.id),
          inheritedItems: preview.projectedItems.filter((p) => p.classification === 'inherited').map((p) => p.id),
          keptItems: preview.projectedItems.filter((p) => p.classification === 'custom_kept').map((p) => p.id),
          overrideConflicts: !!body.overrideConflicts,
          conflictCount: conflicts.length,
          delta: preview.delta,
          postBooking: !PRE_BOOK_STATUSES.has(order.status),
        },
      },
    })
  } catch (err) {
    console.error('[orders/dates/apply] audit log failed:', err)
  }

  return NextResponse.json({
    ok: true,
    newRange: { startDate: newStart.toISOString(), endDate: newEnd.toISOString() },
    itemsUpdated: preview.projectedItems.filter((p) => p.classification !== 'custom_kept').length,
    delta: preview.delta,
    postBooking: !PRE_BOOK_STATUSES.has(order.status),
  })
}
