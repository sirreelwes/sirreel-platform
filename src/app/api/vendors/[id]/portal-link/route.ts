/**
 * POST /api/vendors/[id]/portal-link — mint (or return) the partner's
 * account link. `{ rotate: true }` issues a new one and kills the old.
 * Gated like every sub-rental surface (perms.subRentals).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'
import { ensureVendorPortalToken, rotateVendorPortalToken, vendorAccountUrl } from '@/lib/sub-rentals/vendorAccount'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true, salesOnly: true, email: true } })
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!getPermissions({ role: user.role, salesOnly: user.salesOnly, email: user.email }).subRentals) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as { rotate?: unknown }
  try {
    const token = body.rotate === true ? await rotateVendorPortalToken(params.id) : await ensureVendorPortalToken(params.id)
    return NextResponse.json({ ok: true, url: vendorAccountUrl(token) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 404 })
  }
}
