/**
 * /api/sub-rentals/[id]
 *
 *   GET    → single sub-rental with vendor + order + line
 *   PATCH  → edit Phase 1 fields (vendor, qty, dates, vendor* rates,
 *            receiveMethod, PO #, notes, status), plus
 *            driverOnProductionPayroll — the union-job switch that keeps the
 *            driver charge off our invoice. That one is audit-logged on its
 *            own: it decides who pays a person, it changes after the fact
 *            (a job goes union late), and the partner reads the answer on
 *            their page. Re-derives client* when quantity changes and
 *            orderLineItemId is set.
 *
 *   Moving a sub-rental to CONFIRMED / PICKED_UP / ON_RENT is GATED on the
 *   job's certificate of insurance (lib/sub-rentals/coiGate.ts) — 409
 *   coi_not_cleared unless the caller sends a written coiOverrideReason,
 *   which is audit-logged. ESTIMATED and REQUESTED are not gated.
 *
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
import { checkSubRentalCoi, isCoiGatedSubRentalStatus } from '@/lib/sub-rentals/coiGate'

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
    select: { id: true, orderLineItemId: true, quantity: true, driverOnProductionPayroll: true },
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
    driverOnProductionPayroll?: boolean
    /** Written reason to commit a partner's unit onto a job whose COI has
     *  not cleared. Refused without one — see lib/sub-rentals/coiGate.ts. */
    coiOverrideReason?: string
  } | null
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 })

  if (body.receiveMethod && !Object.values(ReceiveMethod).includes(body.receiveMethod as ReceiveMethod)) {
    return NextResponse.json({ error: 'invalid receiveMethod' }, { status: 400 })
  }
  if (body.status && !Object.values(SubRentalStatus).includes(body.status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  }

  // Committing a partner's unit to a job is the moment the production's
  // insurance has to be real: the partner agreements promise the partner that
  // coverage by name (§3, §4) and cap what SirReel owes when it isn't there
  // (§5). Refuse, and say why, unless someone writes down a reason.
  let coiOverride: { reason: string; state: string | null } | null = null
  if (isCoiGatedSubRentalStatus(body.status)) {
    const verdict = await checkSubRentalCoi(params.id)
    if (!verdict.ok) {
      const reason = body.coiOverrideReason?.trim()
      if (!reason) {
        return NextResponse.json(
          {
            error: 'coi_not_cleared',
            message: verdict.reason,
            coiState: verdict.state,
            jobId: verdict.jobId,
            // The client shows this, collects a reason, and re-POSTs with
            // coiOverrideReason set.
            overridable: true,
          },
          { status: 409 },
        )
      }
      coiOverride = { reason: reason.slice(0, 500), state: verdict.state }
    }
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
      ...(typeof body.driverOnProductionPayroll === 'boolean'
        ? { driverOnProductionPayroll: body.driverOnProductionPayroll }
        : {}),
      ...(derivedClientDailyRate !== undefined ? { clientDailyRate: derivedClientDailyRate } : {}),
      ...(derivedClientTotal !== undefined ? { clientTotal: derivedClientTotal } : {}),
    },
    include: {
      vendor: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true } },
      orderLineItem: { select: { id: true, description: true } },
    },
  })

  // Who pays the driver is the one field here worth its own audit row: the
  // charge it suppresses is several hundred dollars a day, and "nobody
  // remembers turning it on" is exactly the argument this settles.
  if (
    typeof body.driverOnProductionPayroll === 'boolean' &&
    body.driverOnProductionPayroll !== existing.driverOnProductionPayroll
  ) {
    await prisma.auditLog.create({
      data: {
        action: 'sub_rental.driver_payroll_set',
        entityType: 'SubRental',
        entityId: params.id,
        userId: gate.user.id,
        oldValues: { driverOnProductionPayroll: existing.driverOnProductionPayroll },
        newValues: { driverOnProductionPayroll: body.driverOnProductionPayroll, via: 'sub_rental.patch' },
      },
    })
  }

  // An override is the whole point of letting the gate be passed: the row says
  // who decided a partner's unit could go out uninsured, and why.
  if (coiOverride) {
    await prisma.auditLog.create({
      data: {
        action: 'sub_rental.coi_gate_override',
        entityType: 'SubRental',
        entityId: params.id,
        userId: gate.user.id,
        oldValues: { coiState: coiOverride.state },
        newValues: { status: body.status, reason: coiOverride.reason, via: 'sub_rental.patch' },
      },
    })
  }

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
