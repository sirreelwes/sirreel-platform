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
import { isPartnerKind } from '@/lib/sub-rentals/partnerKind'
import { isPartnerSectionKey } from '@/lib/site/partnerSections'

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
    address?: string | null
    poEmail?: string | null
    supplies?: string | null
    deliveryTerms?: string | null
    isActive?: boolean
    /** May we name them to clients? Agreement cl. 10 makes this THEIR
     *  permission, so turning it on requires a note saying what they said. */
    nameClientFacing?: boolean
    namePermissionNote?: string | null
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
  const address = nullableTrim(body.address)
  if (address !== undefined) data.address = address
  const poEmail = nullableTrim(body.poEmail)
  if (poEmail !== undefined) data.poEmail = poEmail
  const supplies = nullableTrim(body.supplies)
  if (supplies !== undefined) data.supplies = supplies
  const deliveryTerms = nullableTrim(body.deliveryTerms)
  if (deliveryTerms !== undefined) data.deliveryTerms = deliveryTerms
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  // What kind of partner, and where their listed units sit on sirreel.com.
  if ('partnerKind' in body) {
    const k = (body as Record<string, unknown>).partnerKind
    if (!isPartnerKind(k)) return NextResponse.json({ error: 'partnerKind must be VEHICLES or EQUIPMENT' }, { status: 400 })
    data.partnerKind = k
  }
  if ('catalogSection' in body) {
    const k = (body as Record<string, unknown>).catalogSection
    if (!isPartnerSectionKey(k)) return NextResponse.json({ error: 'unknown catalogSection' }, { status: 400 })
    data.catalogSection = k
  }
  const coiPatch: { coiReceivedAt?: Date | null; coiExpiresAt?: Date | null } = {}
  for (const k of ['coiReceivedAt', 'coiExpiresAt'] as const) {
    if (!(k in body)) continue
    const raw = (body as Record<string, unknown>)[k]
    if (raw === null || raw === '') { coiPatch[k] = null; continue }
    const d = typeof raw === 'string' ? new Date(raw) : null
    if (!d || Number.isNaN(d.getTime())) return NextResponse.json({ error: `${k} must be a date` }, { status: 400 })
    coiPatch[k] = d
  }
  Object.assign(data, coiPatch)
  if (typeof body.nameClientFacing === 'boolean') {
    if (body.nameClientFacing) {
      const note = typeof body.namePermissionNote === 'string' ? body.namePermissionNote.trim() : ''
      // Clause 10 says we may not use a partner's name client-facing without
      // their WRITTEN permission. Recording where that permission came from is
      // the difference between a policy and a checkbox.
      if (!note) {
        return NextResponse.json(
          { error: 'Say where their written permission came from before naming them to clients.' },
          { status: 400 },
        )
      }
      data.nameClientFacing = true
      data.namePermissionAt = new Date()
      data.namePermissionNote = note.slice(0, 1000)
    } else {
      // Withdrawing is immediate and needs no reason — same shape as the
      // per-unit marketing withdrawal in vendorAccountActions.setUnitMarketing.
      data.nameClientFacing = false
      data.namePermissionAt = null
      data.namePermissionNote = null
    }
  }

  if ('partnerSharePercent' in body) {
    // SirReel's share of the vehicle rental rate (the deal). Empty clears it.
    const raw = body.partnerSharePercent
    const n = raw === null || raw === '' ? null : Number(raw)
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) {
      return NextResponse.json({ error: 'partnerSharePercent must be 0–100' }, { status: 400 })
    }
    data.partnerSharePercent = n === null ? null : Math.round(n * 100) / 100
  }

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
