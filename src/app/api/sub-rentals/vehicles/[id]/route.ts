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
  // Separate from `description` on purpose — that one is staff-facing and
  // carries operational caveats. This is the only prose the client page renders.
  if ('publicDescription' in body) data.publicDescription = typeof body.publicDescription === 'string' && body.publicDescription.trim() ? body.publicDescription.trim() : null
  // Public-catalog listing. Separate decision from the unlisted token: a unit
  // can have a private link, a catalog entry, both, or neither. A slug is
  // derived on first listing if one hasn't been set.
  if (typeof body.publiclyListed === 'boolean') data.publiclyListed = body.publiclyListed
  if ('publicSlug' in body) {
    const raw = typeof body.publicSlug === 'string' ? body.publicSlug : ''
    const slug = raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    data.publicSlug = slug || null
  }
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
    // /vehicles/[slug] is ONE slug space shared with the owned catalog, and
    // getPublicVehicleBySlug checks owned first — so a colliding slug wouldn't
    // error, it would silently render the other vehicle. The unique index on
    // this table can't see that, so check across catalogs explicitly.
    if (typeof data.publicSlug === 'string' && data.publicSlug) {
      const clash = await prisma.vehicleCategory.findFirst({
        where: { slug: data.publicSlug }, select: { name: true },
      })
      if (clash) {
        return NextResponse.json(
          { error: `That catalog URL is already used by "${clash.name}" in the owned fleet — pick another.` },
          { status: 409 },
        )
      }
    }
    if (data.publiclyListed === true && data.publicSlug === undefined) {
      const cur = await prisma.subcontractedVehicle.findUnique({
        where: { id: params.id }, select: { publicSlug: true, name: true },
      })
      if (cur && !cur.publicSlug) {
        const derived = cur.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        const clash = await prisma.vehicleCategory.findFirst({ where: { slug: derived }, select: { id: true } })
        // Suffix rather than fail: the rep asked to list it, not to name it.
        data.publicSlug = clash ? `${derived}-partner` : derived
      }
    }
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
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: 'That catalog URL is already taken — pick another.' }, { status: 409 })
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
