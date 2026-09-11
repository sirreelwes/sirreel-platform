/**
 * POST /api/orders/[id]/line-items/[lineId]/switch-class
 *
 * Move a vehicle line to a DIFFERENT class — "Cargo Van w/ Liftgate" to
 * the one without, or up to a SuperCube — without touching the quoted
 * money unless the rep asks.
 *
 * Wes 2026-09-11: "I need to be able to switch cargo van w/ liftgate to
 * one without liftgate, or to a cube truck, which will of course affect
 * the quote, but not automatically — say if we are out of one class but
 * want to upgrade them at no extra cost."
 *
 * So the line's DESCRIPTION and catalog row change (the client sees the
 * truck they are getting), the HOLD moves classes (the old class's units
 * on this order are released by asset, the new class is held and a unit
 * bound the way a fresh vehicle line is), and the RATE stays exactly what
 * was quoted unless `keepRate` is false. A kept rate that differs from
 * the new class's price is recorded as an override, so the audit says
 * "quoted $170 on a $290 class" rather than looking like a typo.
 *
 * Body:
 *   { categoryId, keepRate?: boolean = true,
 *     unitAssignment?: { mode: 'next' | 'named' | 'none', assetIds? },
 *     confirmConflict?: boolean }
 *
 * The class is the AssetCategory id the scheduling feeds use; the catalog
 * row behind it is resolved here. Capacity on the new class is checked
 * the way a line add checks it — 409 with the named conflicts, override
 * with confirmConflict. Partner-fulfilled lines and included accessories
 * are refused: the first is the partner's calendar, the second is
 * derived from its parent.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recalcOrderTotals } from '@/lib/orders'
import { computeLineTotal } from '@/lib/orders/billing'
import { isLineItemEditable, lineEditLockReason } from '@/lib/orders/editability'
import { checkHoldFeasibility, syncHoldOnLineAdd } from '@/lib/orders/holdsSync'
import { holdOnQuoteSend } from '@/lib/orders/holdOnQuoteSend'
import { assignUnitsForLine, parseUnitAssignment, type UnitAssignmentOutcome } from '@/lib/orders/assignUnitsForLine'
import { releaseBookingItem } from '@/lib/scheduling/releaseBookingItem'
import { resolveLineRate, logRateOverride } from '@/lib/pricing/resolveRate'
import { extractIp, resolveOperatorId } from '@/lib/orders/auditLineItemEdit'
import { syncOrderKitPieces } from '@/lib/orders/kitSync'
import { syncOrderWindowSafe } from '@/lib/orders/syncOrderWindow'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; lineId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: orderId, lineId } = await params

  const body = (await req.json().catch(() => null)) as
    | { categoryId?: string; keepRate?: boolean; unitAssignment?: unknown; confirmConflict?: boolean }
    | null
  if (!body?.categoryId) return NextResponse.json({ error: 'categoryId required' }, { status: 400 })
  const keepRate = body.keepRate !== false

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, status: true, bookingId: true, companyId: true },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  const line = await prisma.orderLineItem.findFirst({
    where: { id: lineId, orderId },
    select: {
      id: true, type: true, description: true, department: true, quantity: true,
      rate: true, rateType: true, billableDays: true, pickupDate: true, returnDate: true,
      assetCategoryId: true, autoKitPieceId: true, parentLineItemId: true,
      inventoryItem: { select: { id: true, description: true, legacyAssetCategoryId: true } },
      subRentals: { select: { id: true }, take: 1 },
    },
  })
  if (!line) return NextResponse.json({ error: 'line not found' }, { status: 404 })
  if (line.department !== 'VEHICLES' || line.type === 'FEE' || line.type === 'DISCOUNT') {
    return NextResponse.json({ error: 'not a vehicle line', reason: 'Only a vehicle line can change class.' }, { status: 400 })
  }
  if (line.subRentals.length > 0) {
    return NextResponse.json({ error: 'partner line', reason: 'This line is fulfilled by a partner — change it on the sub-rental, not here.' }, { status: 409 })
  }
  if (line.autoKitPieceId) {
    return NextResponse.json({ error: 'kit piece', reason: 'An included accessory follows its parent line.' }, { status: 409 })
  }
  if (!isLineItemEditable(order.status, 'VEHICLES')) {
    return NextResponse.json(
      { error: 'line edit not permitted', reason: lineEditLockReason(order.status, 'VEHICLES') ?? 'edit not permitted in current order state' },
      { status: 409 },
    )
  }

  const oldCategoryId = line.assetCategoryId ?? line.inventoryItem?.legacyAssetCategoryId ?? null
  if (oldCategoryId === body.categoryId) {
    return NextResponse.json({ error: 'same class', reason: 'The line is already that class.' }, { status: 400 })
  }
  const target = await prisma.inventoryItem.findFirst({
    where: { legacyAssetCategoryId: body.categoryId, department: 'VEHICLES', trackingMode: 'UNIT_TRACKED' },
    select: { id: true, description: true, code: true, legacyAssetCategoryId: true },
  })
  if (!target?.legacyAssetCategoryId) {
    return NextResponse.json({ error: 'class not found', reason: 'That vehicle class has no catalog row to quote from.' }, { status: 404 })
  }
  const newCategoryId = target.legacyAssetCategoryId
  const qty = Math.max(1, line.quantity)

  // ── Capacity on the new class, same posture as a line add ──────────
  let overrideNote: string | null = null
  if (order.bookingId) {
    const feas = await checkHoldFeasibility({
      tx: prisma,
      categoryId: newCategoryId,
      startDate: line.pickupDate,
      endDate: line.returnDate,
      deltaQty: qty,
      excludeBookingId: order.bookingId,
    })
    if (!feas.capacityClear && body.confirmConflict !== true) {
      return NextResponse.json(
        {
          error: 'over-capacity',
          requiresConfirmation: true,
          reason: `${target.description ?? target.code}: moving ${qty} unit(s) here would exceed the class's capacity for ${line.pickupDate.toISOString().slice(0, 10)}–${line.returnDate.toISOString().slice(0, 10)}. ${feas.conflicts.length} other booking(s) hold it in the window.`,
          category: { id: newCategoryId },
          availability: feas.availability,
          conflicts: feas.conflicts.map((c) => ({
            bookingNumber: c.bookingNumber, jobName: c.jobName,
            startDate: c.startDate.toISOString().slice(0, 10), endDate: c.endDate.toISOString().slice(0, 10),
            quantity: c.quantity, status: c.status,
          })),
        },
        { status: 409 },
      )
    }
    if (!feas.capacityClear) {
      overrideNote = `CAPACITY OVERRIDE on ${order.orderNumber} (class switch, qty ${qty}): conflicts with ${feas.conflicts.map((c) => `${c.bookingNumber}${c.jobName ? ' / ' + c.jobName : ''}`).join('; ')}`
    }
  }

  // ── Money: keep what was quoted, or take the new class's price ─────
  // resolveLineRate treats the client-sent rate as the ask and the
  // catalog/rate-card as the truth, so passing the OLD rate against the
  // NEW row yields exactly the override record a kept rate deserves.
  const operatorId = await resolveOperatorId(session.user.email)
  const oldRate = new Prisma.Decimal(line.rate)
  let rateRes = await resolveLineRate({
    inventoryItemId: target.id,
    assetCategoryId: null,
    rateType: line.rateType,
    clientRate: oldRate.toString(),
    companyId: order.companyId,
  })
  if (!rateRes) return NextResponse.json({ error: 'invalid rate' }, { status: 400 })
  if (!keepRate && rateRes.resolvedRate) {
    rateRes = { rate: rateRes.resolvedRate, resolvedRate: rateRes.resolvedRate, rateOverridden: false }
  }
  const lineTotal = computeLineTotal({
    quantity: qty,
    rate: rateRes.rate.toNumber(),
    billableDays: line.billableDays,
    rateType: line.rateType,
    department: 'VEHICLES',
  })

  const updated = await prisma.orderLineItem.update({
    where: { id: line.id },
    data: {
      inventoryItemId: target.id,
      assetCategoryId: null,
      description: target.description ?? target.code,
      rate: rateRes.rate,
      resolvedRate: rateRes.resolvedRate,
      rateOverridden: rateRes.rateOverridden,
      lineTotal: Math.round(lineTotal * 100) / 100,
    },
    select: { id: true, description: true, rate: true, resolvedRate: true, rateOverridden: true, lineTotal: true, quantity: true },
  })
  if (rateRes.rateOverridden && rateRes.resolvedRate) {
    try {
      await logRateOverride(prisma, {
        orderId,
        orderLineItemId: line.id,
        resolvedRate: rateRes.resolvedRate,
        overrideRate: rateRes.rate,
        rateType: line.rateType,
        userId: operatorId,
        ipAddress: extractIp(req),
      })
    } catch (err) {
      console.error('[switch-class] rate-override audit failed:', err instanceof Error ? err.message : err)
    }
  }

  // ── Holds: the old class lets go of THIS order's units, the new one takes them ──
  let released: { units: string[]; pooledSlots: number } = { units: [], pooledSlots: 0 }
  let unitOutcome: UnitAssignmentOutcome | null = null
  if (order.bookingId && oldCategoryId) {
    const oldItem = await prisma.bookingItem.findFirst({
      where: { bookingId: order.bookingId, categoryId: oldCategoryId, status: { in: ['REQUESTED', 'ASSIGNED'] } },
      orderBy: { holdRank: 'asc' },
      select: {
        id: true,
        assignments: {
          where: { status: { in: ['ASSIGNED', 'CHECKED_OUT'] }, orderId },
          select: { assetId: true, asset: { select: { unitName: true } } },
        },
      },
    })
    if (oldItem) {
      // By ASSET, never the whole line: the item is shared by every
      // vehicle line of that class on the job (project_release_by_asset).
      const mine = oldItem.assignments.slice(0, qty)
      const pooledSlots = Math.max(0, qty - mine.length)
      const rel = await releaseBookingItem(oldItem.id, { assetIds: mine.map((a) => a.assetId), pooledSlots })
      if (rel.ok) released = { units: mine.map((a) => a.asset.unitName), pooledSlots }
      else console.error('[switch-class] old-class release failed:', rel.reason)
    }
  }
  if (order.bookingId) {
    await syncHoldOnLineAdd(prisma, {
      bookingId: order.bookingId,
      categoryId: newCategoryId,
      addedQty: qty,
      conflictOverrideNote: overrideNote,
    })
  } else {
    const raised = await holdOnQuoteSend(orderId)
    if (raised.error) console.error('[switch-class] hold failed:', raised.error)
  }
  unitOutcome = await assignUnitsForLine({
    orderId,
    categoryId: newCategoryId,
    quantity: qty,
    request: parseUnitAssignment(body.unitAssignment),
    categoryLabel: updated.description,
  })

  const kitSync = await syncOrderKitPieces(prisma, orderId)
  const totals = await recalcOrderTotals(orderId)
  await syncOrderWindowSafe(orderId)

  // Always audited — a no-charge upgrade is exactly the kind of thing
  // someone asks about at invoice time, whatever the order's status.
  try {
    await prisma.auditLog.create({
      data: {
        userId: operatorId ?? null,
        ipAddress: extractIp(req),
        action: 'order.line_class_switched',
        entityType: 'Order',
        entityId: orderId,
        oldValues: {
          lineItemId: line.id,
          description: line.description,
          inventoryItemId: line.inventoryItem?.id ?? null,
          categoryId: oldCategoryId,
          rate: oldRate.toString(),
          releasedUnits: released.units,
        },
        newValues: {
          description: updated.description,
          inventoryItemId: target.id,
          categoryId: newCategoryId,
          rate: updated.rate.toString(),
          resolvedRate: updated.resolvedRate?.toString() ?? null,
          keepRate,
          rateOverridden: updated.rateOverridden,
          assignedUnits: unitOutcome.assigned.map((a) => a.unitName),
          unitNote: unitOutcome.note,
          capacityOverride: overrideNote,
        },
      },
    })
  } catch (err) {
    console.error('[switch-class] audit failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({
    ok: true,
    lineItem: updated,
    rate: {
      kept: keepRate,
      rate: updated.rate.toString(),
      classRate: updated.resolvedRate?.toString() ?? null,
      overridden: updated.rateOverridden,
    },
    released,
    unitAssignment: unitOutcome,
    kit: kitSync.noop ? null : kitSync,
    totals,
  })
}
