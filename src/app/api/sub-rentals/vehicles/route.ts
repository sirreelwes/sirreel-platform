/**
 * /api/sub-rentals/vehicles — subcontracted-vehicle roster.
 *
 *   GET  ?includeInactive=1 → list (with vendor), name ASC
 *   POST                    → create one. Accepts either vendorId or a
 *                             vendorName to quick-create the vendor in
 *                             the same transaction (King Kong PV etc.).
 *
 * Auth: requireSubVehicleAccess on BOTH verbs — unlike /api/sub-rentals,
 * even reads are money-sensitive here (vendor list rates + our
 * negotiated discount), so fleet-side roles never see the numbers.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseMoney } from '@/lib/pricing/resolveRate'
import { requireSubVehicleAccess } from '@/lib/sub-rentals/auth'
import { parsePercent } from '@/lib/sub-rentals/vehicles'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const includeInactive = new URL(req.url).searchParams.get('includeInactive') === '1'
  const vehicles = await prisma.subcontractedVehicle.findMany({
    where: includeInactive ? {} : { isActive: true },
    include: { vendor: { select: { id: true, name: true, contactName: true, phone: true, email: true } } },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })
  return NextResponse.json({ vehicles })
}

export async function POST(req: NextRequest) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => null) as {
    vendorId?: string | null
    vendorName?: string | null
    name?: string
    vehicleType?: string | null
    description?: string | null
    specs?: string | null
    listDailyRate?: number | string | null
    listWeeklyRate?: number | string | null
    listMonthlyRate?: number | string | null
    rateNotes?: string | null
    discountPercent?: number | string | null
  } | null
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!body.vendorId && !body.vendorName?.trim()) {
    return NextResponse.json({ error: 'vendorId or vendorName is required' }, { status: 400 })
  }

  const vehicle = await prisma.$transaction(async (tx) => {
    let vendorId = body.vendorId ?? null
    if (!vendorId) {
      const name = body.vendorName!.trim()
      // Quick-create is upsert-by-name so retyping an existing vendor
      // (or a double-submit) attaches instead of erroring on @unique.
      const vendor = await tx.vendor.upsert({
        where: { name },
        update: {},
        create: { name },
      })
      vendorId = vendor.id
    }
    return tx.subcontractedVehicle.create({
      data: {
        vendorId,
        name: body.name!.trim(),
        vehicleType: body.vehicleType?.trim() || null,
        description: body.description?.trim() || null,
        specs: body.specs?.trim() || null,
        listDailyRate: parseMoney(body.listDailyRate),
        listWeeklyRate: parseMoney(body.listWeeklyRate),
        listMonthlyRate: parseMoney(body.listMonthlyRate),
        rateNotes: body.rateNotes?.trim() || null,
        discountPercent: parsePercent(body.discountPercent),
      },
      include: { vendor: { select: { id: true, name: true } } },
    })
  })

  return NextResponse.json({ vehicle }, { status: 201 })
}
