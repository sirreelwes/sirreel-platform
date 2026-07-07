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
  const rows = await prisma.vendor.findMany({
    where: includeArchived ? {} : { isActive: true },
    include: {
      _count: { select: { subRentals: true, inventoryItems: true } },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })
  // `effectivePoEmail` resolves the PO destination: explicit poEmail wins,
  // else fall back to the primary contact email. Raw `poEmail` is kept
  // alongside so the admin edit form shows the stored value, not the
  // fallback. Later PO/request phases read `effectivePoEmail`.
  const vendors = rows.map((v) => ({
    ...v,
    effectivePoEmail: v.poEmail ?? v.email ?? null,
  }))
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
    address?: string | null
    poEmail?: string | null
    supplies?: string | null
    deliveryTerms?: string | null
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

  const trimOrNull = (v: string | null | undefined) => {
    const t = (v ?? '').trim()
    return t.length === 0 ? null : t
  }

  const vendor = await prisma.vendor.create({
    data: {
      name: body.name.trim(),
      contactName: trimOrNull(body.contactName),
      email: trimOrNull(body.email),
      phone: trimOrNull(body.phone),
      website: trimOrNull(body.website),
      notes: trimOrNull(body.notes),
      address: trimOrNull(body.address),
      poEmail: trimOrNull(body.poEmail),
      supplies: trimOrNull(body.supplies),
      deliveryTerms: trimOrNull(body.deliveryTerms),
    },
  })
  return NextResponse.json(vendor, { status: 201 })
}
