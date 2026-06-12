import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { issueJobMagicLink, revokeJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalTokenUrl } from '@/lib/portal/portalUrl'

export const dynamic = 'force-dynamic'

/**
 * GET    /api/orders/[id]/portal-access — list every PortalAccess row for
 *                                          the order's contacts (active +
 *                                          revoked, ordered by most recent).
 * POST   /api/orders/[id]/portal-access — issue a new magic link.
 *                                          Body: { contactId, regenerate? }
 *                                          regenerate=true revokes any
 *                                          existing active access for the
 *                                          same contact first.
 * PATCH  /api/orders/[id]/portal-access — revoke a single access row.
 *                                          Body: { portalAccessId }
 *
 * Sales/admin tool. Returns the bare magic-link URL on POST so the rep can
 * paste it into a manual email — automated invite send lands in a follow-up
 * commit (TODO: Phase 3.5 multi-contact authorization flow).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accesses = await prisma.portalAccess.findMany({
    where: { orderId: params.id },
    orderBy: { createdAt: 'desc' },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })

  // Don't ship raw tokens in this list — rep already has them via the
  // POST response. Exposing them again gives the listing more authority
  // than it should have.
  return NextResponse.json({
    accesses: accesses.map((a) => ({
      id: a.id,
      contact: a.contact,
      magicLinkExpiresAt: a.magicLinkExpiresAt,
      revokedAt: a.revokedAt,
      revokedBy: a.revokedBy,
      lastAccessedAt: a.lastAccessedAt,
      accessCount: a.accessCount,
      createdAt: a.createdAt,
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    contactId?: unknown
    regenerate?: unknown
  }
  if (typeof body.contactId !== 'string' || !body.contactId) {
    return NextResponse.json({ error: 'contactId required' }, { status: 400 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true, portalSlug: true, companyId: true },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  if (!order.portalSlug) {
    return NextResponse.json({ error: 'Order has no portal slug' }, { status: 409 })
  }

  const contact = await prisma.person.findUnique({
    where: { id: body.contactId },
    select: { id: true, email: true },
  })
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  if (body.regenerate === true) {
    // Revoke any currently-active access rows for this contact on this order
    // before minting a new one. We don't delete — the row survives for audit.
    const open = await prisma.portalAccess.findMany({
      where: { orderId: order.id, contactId: contact.id, revokedAt: null },
      select: { id: true },
    })
    for (const o of open) {
      await revokeJobMagicLink({ portalAccessId: o.id, revokedBy: sessionUser.id })
    }
  }

  const issued = await issueJobMagicLink({ orderId: order.id, contactId: contact.id })
  const url = `${portalTokenUrl(order.portalSlug)}?token=${encodeURIComponent(issued.token)}`
  return NextResponse.json({
    ok: true,
    portalAccessId: issued.portalAccessId,
    magicLinkExpiresAt: issued.expiresAt,
    portalUrl: url,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { portalAccessId?: unknown }
  if (typeof body.portalAccessId !== 'string' || !body.portalAccessId) {
    return NextResponse.json({ error: 'portalAccessId required' }, { status: 400 })
  }

  // Make sure the access row belongs to this order before revoking — defense
  // against a rep PATCHing one order's path with another order's id.
  const row = await prisma.portalAccess.findUnique({
    where: { id: body.portalAccessId },
    select: { orderId: true, revokedAt: true },
  })
  if (!row || row.orderId !== params.id) {
    return NextResponse.json({ error: 'Access not found on this order' }, { status: 404 })
  }
  if (row.revokedAt) {
    return NextResponse.json({ ok: true, alreadyRevoked: true })
  }

  await revokeJobMagicLink({ portalAccessId: body.portalAccessId, revokedBy: sessionUser.id })
  return NextResponse.json({ ok: true })
}
