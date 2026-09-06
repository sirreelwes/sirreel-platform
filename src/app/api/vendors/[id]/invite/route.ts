/** POST /api/vendors/[id]/invite — email the partner their account link.
 *  Body { to?: string } — defaults to the vendor's contact email. Mints the
 *  token if needed, stamps portalInvitedAt/To, CCs the conduit channel. */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubRentalStaff } from '@/lib/sub-rentals/staffGate'
import { sendVendorInvite } from '@/lib/sub-rentals/vendorInvite'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireSubRentalStaff(); if ('error' in g) return g.error
  const body = (await req.json().catch(() => ({}))) as { to?: unknown }
  const vendor = await prisma.vendor.findUnique({ where: { id: params.id }, select: { email: true } })
  if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  const to = typeof body.to === 'string' && body.to.trim() ? body.to : vendor.email ?? ''
  if (!to) return NextResponse.json({ error: 'No email on file — enter one.' }, { status: 400 })
  const sender = await prisma.user.findUnique({ where: { id: g.user.id }, select: { email: true, name: true } })
  try {
    const r = await sendVendorInvite({ vendorId: params.id, to, sender: { email: sender?.email ?? g.user.email, name: sender?.name ?? null } })
    if (!r.ok) return NextResponse.json({ error: `Email not sent: ${r.reason ?? 'unknown'}` }, { status: 502 })
    return NextResponse.json({ ok: true, to: to.trim().toLowerCase(), url: r.url })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: (e as { status?: number }).status ?? 500 })
  }
}
