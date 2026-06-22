/**
 * /api/vendors
 *
 *   GET  → active vendors (+ subRentals count, for the picker UI)
 *   POST → create vendor; same gate as sub-rental create.
 *
 * Quick-create POST is the path the SubRentalModal hits when the rep
 * types a new vendor name in the picker.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { requireSubRentalAccess } from '@/lib/sub-rentals/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  // The admin page passes `?includeArchived=1` to see both active and
  // soft-deleted rows; pickers (sub-rentals + inventory) leave it off
  // so archived vendors drop out of selection without affecting
  // historical assignments.
  const includeArchived = new URL(req.url).searchParams.get('includeArchived') === '1'
  const vendors = await prisma.vendor.findMany({
    where: includeArchived ? {} : { isActive: true },
    include: {
      _count: { select: { subRentals: true, inventoryItems: true } },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })
  return NextResponse.json({ vendors })
}

export async function POST(req: NextRequest) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => null) as {
    name?: string
    contactName?: string | null
    email?: string | null
    phone?: string | null
    website?: string | null
    notes?: string | null
  } | null

  if (!body || !body.name || !body.name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Vendor.name is @unique — surface a 409 instead of a 500 on dupes.
  const existing = await prisma.vendor.findUnique({ where: { name: body.name.trim() } })
  if (existing) {
    return NextResponse.json(
      { error: 'vendor with that name already exists', vendorId: existing.id },
      { status: 409 },
    )
  }

  const vendor = await prisma.vendor.create({
    data: {
      name: body.name.trim(),
      contactName: body.contactName ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      website: body.website ?? null,
      notes: body.notes ?? null,
    },
  })
  return NextResponse.json(vendor, { status: 201 })
}
