/**
 * /api/vendors/[id]/contacts — the people at a partner, HQ side.
 *
 *   GET  → the list, main contact first
 *   POST → add one { name, email?, phone?, role?, notes?, isPrimary?, emailBookings? }
 *
 * Wes 2026-09-11: "I need to be able to add people on the partner portal.
 * owners and others." The partner keeps the same list from their own page
 * (/api/public/vendor-account/[token]/contacts); the rules live in one place,
 * lib/sub-rentals/vendorContacts.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireSubRentalAccess } from '@/lib/sub-rentals/auth'
import { prisma } from '@/lib/prisma'
import { addVendorContact, listVendorContacts } from '@/lib/sub-rentals/vendorContacts'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate
  const { id } = await params
  return NextResponse.json({ ok: true, contacts: await listVendorContacts(prisma, id) })
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const r = await addVendorContact(prisma, id, body, { byPartner: false })
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, contact: r.contact }, { status: 201 })
}
