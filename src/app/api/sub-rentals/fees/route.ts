/**
 * /api/sub-rentals/fees — ancillary fee schedule for subcontracted rentals.
 *
 *   GET  ?vendorId=&vehicleId=  → fees in effect, sortOrder ASC
 *   POST                        → create one
 *
 * SCOPE, and why GET takes both params: a fee row with vehicleId NULL
 * is the vendor's standing schedule (mileage, supplies) and applies to
 * every unit they own; a row with vehicleId set belongs to that unit
 * alone (a generator fee on a unit that has one). Passing vehicleId
 * returns the UNION of both — which is what a quote actually needs —
 * so callers never have to make two round trips and merge by hand.
 *
 * Auth: requireSubVehicleAccess (subRentals + seePricing) on both
 * verbs, same as the roster — this is vendor cost data.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma, FeeUnit, SubFeeUnionScope } from '@prisma/client'
import { parseMoney } from '@/lib/pricing/resolveRate'
import { requireSubVehicleAccess } from '@/lib/sub-rentals/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const { searchParams } = new URL(req.url)
  const vendorId = searchParams.get('vendorId')
  const vehicleId = searchParams.get('vehicleId')
  const includeInactive = searchParams.get('includeInactive') === '1'

  if (!vendorId && !vehicleId) {
    return NextResponse.json({ error: 'vendorId or vehicleId is required' }, { status: 400 })
  }

  // Resolve the vendor from the vehicle when only the vehicle is known,
  // so the vendor-wide rows come along without the caller knowing who
  // owns the unit.
  let ownerId = vendorId
  if (vehicleId && !ownerId) {
    const v = await prisma.subcontractedVehicle.findUnique({
      where: { id: vehicleId },
      select: { vendorId: true },
    })
    if (!v) return NextResponse.json({ error: 'vehicle not found' }, { status: 404 })
    ownerId = v.vendorId
  }

  const where: Prisma.SubcontractedFeeWhereInput = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(vehicleId
      ? { vendorId: ownerId!, OR: [{ vehicleId: null }, { vehicleId }] }
      : { vendorId: ownerId! }),
  }

  const fees = await prisma.subcontractedFee.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })
  return NextResponse.json({ fees })
}

export async function POST(req: NextRequest) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => null) as {
    vendorId?: string
    vehicleId?: string | null
    label?: string
    amount?: number | string
    unit?: string
    coversHours?: number | string | null
    unionScope?: string | null
    discountApplies?: boolean
    notes?: string | null
    sortOrder?: number
  } | null

  if (!body?.label?.trim()) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }
  const amount = parseMoney(body.amount)
  if (amount == null) {
    return NextResponse.json({ error: 'a numeric amount is required' }, { status: 400 })
  }
  if (!body.unit || !Object.values(FeeUnit).includes(body.unit as FeeUnit)) {
    return NextResponse.json({ error: 'a valid unit is required' }, { status: 400 })
  }
  const unionScope = body.unionScope && Object.values(SubFeeUnionScope).includes(body.unionScope as SubFeeUnionScope)
    ? (body.unionScope as SubFeeUnionScope)
    : SubFeeUnionScope.ALL

  // A vehicle-scoped fee must inherit that vehicle's vendor — trusting a
  // caller-supplied vendorId here would let a fee attach to one vendor's
  // schedule while pointing at another's unit.
  let vendorId = body.vendorId ?? null
  if (body.vehicleId) {
    const v = await prisma.subcontractedVehicle.findUnique({
      where: { id: body.vehicleId },
      select: { vendorId: true },
    })
    if (!v) return NextResponse.json({ error: 'vehicle not found' }, { status: 404 })
    vendorId = v.vendorId
  }
  if (!vendorId) {
    return NextResponse.json({ error: 'vendorId or vehicleId is required' }, { status: 400 })
  }

  const fee = await prisma.subcontractedFee.create({
    data: {
      vendorId,
      vehicleId: body.vehicleId ?? null,
      label: body.label.trim(),
      amount,
      unit: body.unit as FeeUnit,
      coversHours: parseMoney(body.coversHours),
      unionScope,
      discountApplies: body.discountApplies === true,
      notes: body.notes?.trim() || null,
      sortOrder: Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : 0,
    },
  })

  return NextResponse.json({ fee }, { status: 201 })
}
