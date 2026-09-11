/**
 * /api/vendors/[id]/contacts/[contactId] — edit or remove one of a partner's
 * people, HQ side.
 *
 *   PATCH  → the whole person, revalidated (vendorContacts.cleanContactInput)
 *   DELETE → take them off the list. The row stays (isActive false): who we
 *            used to email is history. The main contact cannot be removed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireSubRentalAccess } from '@/lib/sub-rentals/auth'
import { prisma } from '@/lib/prisma'
import { removeVendorContact, updateVendorContactRow } from '@/lib/sub-rentals/vendorContacts'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; contactId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate
  const { id, contactId } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const r = await updateVendorContactRow(prisma, id, contactId, body)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, contact: r.contact })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate
  const { id, contactId } = await params
  const r = await removeVendorContact(prisma, id, contactId)
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
