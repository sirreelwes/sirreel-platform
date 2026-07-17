import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { computeLineTotal } from '@/lib/orders/billing'
import { recalcOrderTotals } from '@/lib/orders'
import { isClaimEligible } from '@/lib/orders/days'

export const dynamic = 'force-dynamic'

/**
 * POST /api/orders/[id]/day-claims — agent resolution of shoot-days
 * claims (Wes ruling B). The ONLY writer of claim-driven billableDays.
 *
 * Body, one of:
 *   { lineId, billableDays, note? }             — per-line set
 *   { pickupDate, returnDate, billableDays, note? }
 *     — bulk: every ELIGIBLE (gear/vehicle, non-stage) line on the
 *       order sharing EXACTLY that date range. Deliberately no
 *       global all-lines stamp — different date ranges need
 *       different numbers.
 *
 * Semantics:
 *   - billableDays becomes AUTHORITATIVE for pricing. NO clamping —
 *     it may sit above claimedDays or computedDays; SirReel has final
 *     say. 0 is allowed (negotiated freebie, existing convention).
 *   - A PENDING claim resolves to APPROVED when billableDays equals
 *     the claim, else ADJUSTED (either direction).
 *   - Every set is audit-logged (who/when/from→to).
 *   - Line totals + order totals recomputed server-side; nothing
 *     client-sent is trusted.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orderId = params.id
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const billableDaysRaw = body.billableDays
  const billableDays =
    typeof billableDaysRaw === 'number' && Number.isInteger(billableDaysRaw) && billableDaysRaw >= 0 && billableDaysRaw <= 730
      ? billableDaysRaw
      : null
  if (billableDays === null) {
    return NextResponse.json({ error: 'billableDays must be an integer 0..730' }, { status: 400 })
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null

  const lineId = typeof body.lineId === 'string' ? body.lineId : null
  const pickupDate = typeof body.pickupDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.pickupDate) ? body.pickupDate : null
  const returnDate = typeof body.returnDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.returnDate) ? body.returnDate : null

  let targets
  if (lineId) {
    targets = await prisma.orderLineItem.findMany({
      where: { id: lineId, orderId },
      select: targetSelect,
    })
  } else if (pickupDate && returnDate) {
    targets = await prisma.orderLineItem.findMany({
      where: {
        orderId,
        pickupDate: new Date(`${pickupDate}T00:00:00.000Z`),
        returnDate: new Date(`${returnDate}T00:00:00.000Z`),
        type: { in: ['VEHICLE', 'EQUIPMENT'] },
        department: { not: 'STAGES' },
      },
      select: targetSelect,
    })
  } else {
    return NextResponse.json(
      { error: 'provide lineId, or pickupDate+returnDate for a date-group bulk set' },
      { status: 400 },
    )
  }

  if (targets.length === 0) {
    return NextResponse.json({ error: 'no matching lines' }, { status: 404 })
  }

  const updated: Array<{ id: string; billableDays: number; claimStatus: string; lineTotal: number }> = []
  await prisma.$transaction(async (tx) => {
    for (const line of targets) {
      // Per-line sets on ineligible lines (stage/fee/etc) are allowed
      // only as plain billableDays edits — they never carry claim
      // status. Bulk already filters to eligible.
      const eligible = isClaimEligible({ type: line.type, department: line.department })
      const nextClaimStatus =
        eligible && line.claimStatus === 'PENDING'
          ? line.claimedDays != null && billableDays === line.claimedDays
            ? ('APPROVED' as const)
            : ('ADJUSTED' as const)
          : line.claimStatus
      const lineTotal = computeLineTotal({
        quantity: line.quantity,
        rate: line.rate,
        billableDays,
        rateType: line.rateType,
        department: line.department,
      })
      const roundedTotal = Math.round(lineTotal * 100) / 100
      await tx.orderLineItem.update({
        where: { id: line.id },
        data: {
          billableDays,
          claimStatus: nextClaimStatus,
          ...(note !== null ? { claimNote: note } : {}),
          lineTotal: roundedTotal,
        },
      })
      // who/when/from→to — mirrors the rate-override audit discipline.
      await tx.auditLog.create({
        data: {
          userId: sessionUser.id,
          action: 'order.line_billable_days_set',
          entityType: 'OrderLineItem',
          entityId: line.id,
          oldValues: {
            billableDays: line.billableDays,
            claimStatus: line.claimStatus,
            claimedDays: line.claimedDays,
            computedDays: line.computedDays,
          },
          newValues: {
            billableDays,
            claimStatus: nextClaimStatus,
            note,
            orderId,
            bulkDateGroup: lineId ? null : `${pickupDate}→${returnDate}`,
          },
        },
      })
      updated.push({ id: line.id, billableDays, claimStatus: nextClaimStatus, lineTotal: roundedTotal })
    }
  })

  const totals = await recalcOrderTotals(orderId)
  return NextResponse.json({ ok: true, updated, totals })
}

const targetSelect = {
  id: true,
  type: true,
  department: true,
  quantity: true,
  rate: true,
  rateType: true,
  billableDays: true,
  claimedDays: true,
  computedDays: true,
  claimStatus: true,
} as const
