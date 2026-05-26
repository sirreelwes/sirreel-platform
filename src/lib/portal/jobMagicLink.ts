import { prisma } from '@/lib/prisma'
import { generateMagicLinkToken } from '@/lib/portal/jobSession'

/**
 * Job Page (CRH) magic-link helpers.
 *
 *   - issueJobMagicLink(orderId, contactId): mints a PortalAccess with a
 *     fresh 7-day token. Idempotent on revoked/expired rows for the same
 *     (order, contact) — we create a new row rather than mutating an old
 *     one, so the audit trail of every issued link survives.
 *   - resolveJobMagicLink(slug, token): looks up the PortalAccess by token,
 *     validates the slug matches, returns null if expired/revoked/mismatched.
 *   - resolveJobSession(portalAccessId): loads the PortalAccess for a cookie-
 *     authenticated request, returns null if revoked. Both resolvers also
 *     bump lastAccessedAt/accessCount on success.
 */

const LINK_TTL_DAYS = 7

export interface ResolvedPortalAccess {
  portalAccessId: string
  orderId: string
  contactId: string
  contact: { id: string; firstName: string; lastName: string; email: string } | null
  order: {
    id: string
    orderNumber: string
    portalSlug: string | null
    company: { id: string; name: string }
    portalSunsetAt: Date | null
  }
}

export async function issueJobMagicLink(args: {
  orderId: string
  contactId: string
}): Promise<{ token: string; expiresAt: Date; portalAccessId: string }> {
  const token = generateMagicLinkToken()
  const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 86_400_000)
  const row = await prisma.portalAccess.create({
    data: {
      orderId: args.orderId,
      contactId: args.contactId,
      magicLinkToken: token,
      magicLinkExpiresAt: expiresAt,
    },
    select: { id: true },
  })
  return { token, expiresAt, portalAccessId: row.id }
}

/**
 * Returns a live magic-link token for (orderId, contactId). If a non-
 * expired, non-revoked PortalAccess already exists for the pair, reuses
 * its token; otherwise mints a new one via issueJobMagicLink.
 *
 * Why reuse instead of always-mint: the branded send flows (quote +
 * Mode A follow-ups) call this on every send. If a client gets a quote
 * Monday and a Stage 1 follow-up Wednesday, fresh-mint-every-time
 * would mean two simultaneously-valid tokens for the same contact on
 * the same order. Reuse keeps the audit trail tighter (one row per
 * link-cycle, accessCount accumulates) and avoids the "old link still
 * works" surprise when an agent re-sends.
 */
export async function ensureLiveJobMagicLink(args: {
  orderId: string
  contactId: string
}): Promise<{ token: string; expiresAt: Date; portalAccessId: string; reused: boolean }> {
  const live = await prisma.portalAccess.findFirst({
    where: {
      orderId: args.orderId,
      contactId: args.contactId,
      revokedAt: null,
      magicLinkExpiresAt: { gt: new Date() },
    },
    orderBy: { magicLinkExpiresAt: 'desc' },
    select: { id: true, magicLinkToken: true, magicLinkExpiresAt: true },
  })
  if (live) {
    return {
      token: live.magicLinkToken,
      expiresAt: live.magicLinkExpiresAt,
      portalAccessId: live.id,
      reused: true,
    }
  }
  const issued = await issueJobMagicLink(args)
  return { ...issued, reused: false }
}

export async function resolveJobMagicLink(args: {
  slug: string
  token: string
  now?: Date
}): Promise<ResolvedPortalAccess | null> {
  if (!args.slug || !args.token) return null
  const now = args.now ?? new Date()

  const row = await prisma.portalAccess.findUnique({
    where: { magicLinkToken: args.token },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          portalSlug: true,
          portalSunsetAt: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!row) return null
  if (row.revokedAt) return null
  if (row.magicLinkExpiresAt.getTime() < now.getTime()) return null
  if (!row.order || row.order.portalSlug !== args.slug) return null
  if (row.order.portalSunsetAt && row.order.portalSunsetAt.getTime() < now.getTime()) return null

  await prisma.portalAccess.update({
    where: { id: row.id },
    data: { lastAccessedAt: now, accessCount: { increment: 1 } },
  })

  return {
    portalAccessId: row.id,
    orderId: row.orderId,
    contactId: row.contactId,
    contact: row.contact,
    order: row.order,
  }
}

/**
 * Cookie-authenticated lookup. Differs from resolveJobMagicLink in that the
 * caller has already verified the session signature; we just confirm the
 * PortalAccess row hasn't been revoked and that the order's portal isn't
 * past sunset.
 */
export async function resolveJobSession(args: {
  portalAccessId: string
  now?: Date
}): Promise<ResolvedPortalAccess | null> {
  const now = args.now ?? new Date()
  const row = await prisma.portalAccess.findUnique({
    where: { id: args.portalAccessId },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          portalSlug: true,
          portalSunsetAt: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!row) return null
  if (row.revokedAt) return null
  if (!row.order) return null
  if (row.order.portalSunsetAt && row.order.portalSunsetAt.getTime() < now.getTime()) return null

  return {
    portalAccessId: row.id,
    orderId: row.orderId,
    contactId: row.contactId,
    contact: row.contact,
    order: row.order,
  }
}

export async function revokeJobMagicLink(args: {
  portalAccessId: string
  revokedBy: string
}): Promise<void> {
  await prisma.portalAccess.update({
    where: { id: args.portalAccessId },
    data: { revokedAt: new Date(), revokedBy: args.revokedBy },
  })
}
