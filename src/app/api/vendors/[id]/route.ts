/**
 * PATCH /api/vendors/[id]
 *
 * Edits an existing Vendor or toggles archive state (`isActive`).
 * Vendors are shared between sub-rentals and inventory reorder
 * routing — same auth gate as POST /api/vendors so the manager who
 * curates the vendor list has one consistent set of permissions.
 *
 * Body fields are all optional; only those present are written:
 *   name, contactName, email, phone, website, notes, isActive
 *
 * Archive is "soft-delete via isActive=false" — historical references
 * from SubRental.vendorId / InventoryItem.preferredVendorId stay
 * valid; archived rows drop out of pickers by default but stay
 * visible in the admin page when `?includeArchived=1` is passed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireSubRentalAccess } from '@/lib/sub-rentals/auth'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function nullableTrim(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length === 0 ? null : t
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate

  const { id } = await params
  const body = await req.json().catch(() => ({})) as {
    name?: string
    contactName?: string | null
    email?: string | null
    phone?: string | null
    website?: string | null
    notes?: string | null
    isActive?: boolean
  }

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
    }
    data.name = body.name.trim()
  }
  const contactName = nullableTrim(body.contactName)
  if (contactName !== undefined) data.contactName = contactName
  const email = nullableTrim(body.email)
  if (email !== undefined) data.email = email
  const phone = nullableTrim(body.phone)
  if (phone !== undefined) data.phone = phone
  const website = nullableTrim(body.website)
  if (website !== undefined) data.website = website
  const notes = nullableTrim(body.notes)
  if (notes !== undefined) data.notes = notes
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  try {
    const vendor = await prisma.vendor.update({
      where: { id },
      data,
      include: { _count: { select: { subRentals: true, inventoryItems: true } } },
    })
    return NextResponse.json({ vendor })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return NextResponse.json({ error: 'vendor name already exists' }, { status: 409 })
      }
      if (err.code === 'P2025') {
        return NextResponse.json({ error: 'vendor not found' }, { status: 404 })
      }
    }
    const message = err instanceof Error ? err.message : 'update failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
