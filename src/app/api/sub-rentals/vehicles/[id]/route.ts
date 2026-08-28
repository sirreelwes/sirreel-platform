/**
 * /api/sub-rentals/vehicles/[id]
 *
 *   GET    → single vehicle with vendor
 *   PATCH  → edit any roster field (identity, rate structure,
 *            discount, isActive). Rates/discount PATCH as null to
 *            clear — "field present" is the update signal, so
 *            undefined leaves a value alone.
 *   DELETE → soft-retire via isActive=false (keeps the row for any
 *            history that later phases hang off it).
 *
 * Auth: requireSubVehicleAccess on every verb (money-sensitive reads).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { parseMoney } from '@/lib/pricing/resolveRate'
import { requireSubVehicleAccess } from '@/lib/sub-rentals/auth'
import { parsePercent } from '@/lib/sub-rentals/vehicles'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const VENDOR_SELECT = {
  select: {
    id: true, name: true, contactName: true, email: true, phone: true,
    website: true, address: true, notes: true,
  },
} as const

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const vehicle = await prisma.subcontractedVehicle.findUnique({
    where: { id: params.id },
    include: { vendor: VENDOR_SELECT },
  })
  if (!vehicle) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ vehicle })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  const data: Prisma.SubcontractedVehicleUpdateInput = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
  if ('vehicleType' in body) data.vehicleType = typeof body.vehicleType === 'string' && body.vehicleType.trim() ? body.vehicleType.trim() : null
  if ('description' in body) data.description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
  if ('specs' in body) data.specs = typeof body.specs === 'string' && body.specs.trim() ? body.specs.trim() : null
  if ('rateNotes' in body) data.rateNotes = typeof body.rateNotes === 'string' && body.rateNotes.trim() ? body.rateNotes.trim() : null
  if ('listDailyRate' in body) data.listDailyRate = parseMoney(body.listDailyRate)
  if ('listWeeklyRate' in body) data.listWeeklyRate = parseMoney(body.listWeeklyRate)
  if ('listMonthlyRate' in body) data.listMonthlyRate = parseMoney(body.listMonthlyRate)
  if ('discountPercent' in body) data.discountPercent = parsePercent(body.discountPercent)
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body.vendorId === 'string' && body.vendorId) {
    data.vendor = { connect: { id: body.vendorId } }
  }

  try {
    const vehicle = await prisma.subcontractedVehicle.update({
      where: { id: params.id },
      data,
      include: { vendor: VENDOR_SELECT },
    })
    return NextResponse.json({ vehicle })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate

  try {
    const vehicle = await prisma.subcontractedVehicle.update({
      where: { id: params.id },
      data: { isActive: false },
      include: { vendor: VENDOR_SELECT },
    })
    return NextResponse.json({ vehicle })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    throw e
  }
}
