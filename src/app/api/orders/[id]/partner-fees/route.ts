/**
 * /api/orders/[id]/partner-fees — put a sub-rented unit's ancillary charges
 * on the order.
 *
 *   GET  ?vehicleId=… → the fee schedule + the order's day count, so the rep
 *                       sees what will be added and what needs an estimate
 *   POST              → create the lines
 *
 * Why this exists: SubcontractedFee was readable only by the estimate email,
 * so a quote built from a partner unit was short by the driver, mileage,
 * generator and supplies charges — the majority of a real day's cost, exactly
 * as that model's comment warned. See src/lib/sub-rentals/orderFees.ts for how
 * each fee unit becomes a line and why metered ones carry an estimate note.
 *
 * Idempotency: re-adding the same vehicle's fees to the same order is refused
 * rather than silently doubling the charges. A rep who wants to redo them
 * deletes the lines first — deleting is visible, a duplicated $550 driver fee
 * on a sent quote is not.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recalcOrderTotals } from '@/lib/orders'
import { partnerFeeSchedule, buildFeeLines, type FeeEstimates } from '@/lib/sub-rentals/orderFees'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function loadOrder(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      jobId: true,
      status: true,
      startDate: true,
      endDate: true,
      lineItems: {
        select: {
          id: true, sortOrder: true, description: true, type: true,
          billableDays: true, partnerVehicleId: true, parentLineItemId: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
}

/**
 * Day count for PER_DAY fees. Prefer what the order's own lines already agreed
 * on — if the vehicle line bills 1 day, the driver bills 1 day, and deriving
 * it separately from the date span could disagree with the line right above it
 * on the same page. Falls back to the date span, then to 1.
 */
function orderDays(order: NonNullable<Awaited<ReturnType<typeof loadOrder>>>): number {
  const fromLines = order.lineItems.map((l) => l.billableDays).filter((d): d is number => !!d && d > 0)
  if (fromLines.length) return Math.max(...fromLines)
  if (order.startDate && order.endDate) {
    const span = Math.round((order.endDate.getTime() - order.startDate.getTime()) / 86_400_000) + 1
    if (span > 0) return span
  }
  return 1
}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: orderId } = await params

  const vehicleId = new URL(req.url).searchParams.get('vehicleId')

  const order = await loadOrder(orderId)
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // No vehicle named → which partner units could this order be quoting?
  // Units already sub-rented against this job come first and are the usual
  // answer; the rest of the roster follows, because a rep can be pricing a
  // unit before the sub-rental record exists.
  if (!vehicleId) {
    const onJob = order.jobId
      ? await prisma.subRental.findMany({
          where: { jobId: order.jobId, subcontractedVehicleId: { not: null } },
          select: { subcontractedVehicleId: true },
        })
      : []
    const onJobIds = new Set(onJob.map((s) => s.subcontractedVehicleId!))
    const vehicles = await prisma.subcontractedVehicle.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, vehicleType: true },
    })
    // The lines these fees can hang under. Only top-level vehicle/equipment
    // lines — a fee cannot parent another fee.
    const parents = order.lineItems
      .filter((l) => !l.parentLineItemId && l.type !== 'FEE' && l.type !== 'DISCOUNT')
      .map((l) => ({
        id: l.id,
        description: l.description,
        hasFees: order.lineItems.some((c) => c.parentLineItemId === l.id),
      }))

    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    return NextResponse.json({
      candidates: vehicles
        .map((v) => ({
          ...v,
          onThisJob: onJobIds.has(v.id),
          // Pre-pair the unit with the line that names it, so the rep
          // normally confirms rather than chooses twice.
          suggestedParentId:
            parents.find((pl) => norm(pl.description).includes(norm(v.name)))?.id ?? null,
        }))
        .sort((a, b) => Number(b.onThisJob) - Number(a.onThisJob)),
      parents,
      days: orderDays(order),
    })
  }

  const schedule = await partnerFeeSchedule(vehicleId)
  if (!schedule) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 })

  return NextResponse.json({ ...schedule, days: orderDays(order) })
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: orderId } = await params

  const body = (await req.json().catch(() => ({}))) as {
    vehicleId?: unknown
    parentLineItemId?: unknown
    estimates?: unknown
  }
  const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId : ''
  if (!vehicleId) return NextResponse.json({ error: 'vehicleId is required.' }, { status: 400 })
  const parentLineItemId = typeof body.parentLineItemId === 'string' ? body.parentLineItemId : ''
  if (!parentLineItemId) {
    return NextResponse.json({ error: 'Choose which line these fees belong to.' }, { status: 400 })
  }

  const estimates: FeeEstimates = {}
  if (body.estimates && typeof body.estimates === 'object') {
    for (const [k, v] of Object.entries(body.estimates as Record<string, unknown>)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) estimates[k] = n
    }
  }

  const order = await loadOrder(orderId)
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const schedule = await partnerFeeSchedule(vehicleId)
  if (!schedule) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 })

  const parent = order.lineItems.find((l) => l.id === parentLineItemId)
  if (!parent) return NextResponse.json({ error: 'That line is not on this order.' }, { status: 404 })
  if (parent.parentLineItemId) {
    return NextResponse.json({ error: 'Fees attach to a unit line, not to another fee.' }, { status: 400 })
  }

  // Idempotency is per LINE, not per vehicle — two coaches on one order are
  // two lines and each carries its own usage, so "already added" can only
  // mean "already added to THIS line".
  if (order.lineItems.some((l) => l.parentLineItemId === parentLineItemId)) {
    return NextResponse.json(
      { error: `${parent.description} already has fees. Remove them first to re-add.` },
      { status: 409 },
    )
  }

  const days = orderDays(order)
  const lines = buildFeeLines(schedule.fees, estimates, days, Prisma.Decimal)
  if (!lines.length) {
    return NextResponse.json({ error: 'Nothing to add — no day-rate fees and no usage estimated.' }, { status: 400 })
  }

  // Fee lines inherit the order's own window. OrderLineItem requires both,
  // and a fee that spans a different range than the unit it belongs to would
  // be wrong on the pick list and the invoice alike.
  const pickup = order.startDate ?? new Date()
  const ret = order.endDate ?? pickup

  // Children slot in directly BELOW their parent, so the reader sees the
  // coach and its charges together. Everything after the parent shifts down
  // by the number of children; without this the fees would sort to the
  // bottom of the order and read as unrelated.
  const shiftFrom = parent.sortOrder
  let sortOrder = shiftFrom + 1

  const created = await prisma.$transaction([
    prisma.orderLineItem.updateMany({
      where: { orderId, sortOrder: { gt: shiftFrom } },
      data: { sortOrder: { increment: lines.length } },
    }),
    ...lines.map((l) =>
      prisma.orderLineItem.create({
        data: {
          orderId,
          sortOrder: sortOrder++,
          type: 'FEE',
          department: 'PRO_SUPPLIES',
          description: l.description,
          rateType: l.rateType,
          rate: l.rate,
          quantity: l.quantity,
          billableDays: l.billableDays,
          computedDays: l.billableDays,
          pickupDate: pickup,
          returnDate: ret,
          lineTotal: l.lineTotal,
          notes: l.notes,
          usageEstimated: l.usageEstimated,
          // Provenance, and the idempotency key the 409 above reads. NOT
          // `qualifier` — that prints on the quote.
          partnerVehicleId: vehicleId,
          parentLineItemId,
        },
        select: { id: true, description: true, lineTotal: true, usageEstimated: true },
      }),
    ),
  ])

  await recalcOrderTotals(orderId)

  await prisma.auditLog.create({
    data: {
      action: 'order.partner_fees_added',
      entityType: 'Order',
      entityId: orderId,
      newValues: {
        vehicleId,
        vehicleName: schedule.vehicleName,
        days,
        estimates,
        parentLineItemId,
        parentDescription: parent.description,
        lines: lines.map((l) => ({ description: l.description, total: l.lineTotal.toString() })),
      },
    },
  })

  // First element is the updateMany batch payload, not a line.
  const createdLines = created.slice(1) as Array<{ id: string; description: string; lineTotal: unknown; usageEstimated: boolean }>
  return NextResponse.json({ ok: true, added: createdLines.length, lines: createdLines })
}
