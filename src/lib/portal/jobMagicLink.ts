import { prisma } from '@/lib/prisma'
import { alertFirstPortalOpen } from '@/lib/portal/firstOpenAlert'
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

/**
 * Orders that are over. A portal must not speak for one. CANCELLED is the
 * only such value on OrderStatus — LOST belongs to OrderQuoteStatus and VOID
 * to invoices. CLOSED is deliberately live here: a wrapped rental still has a
 * portal worth reading.
 */
const DEAD_ORDER_STATUSES: string[] = ['CANCELLED']

/** The order fields a portal session needs — see resolvePortalOrder. */
export interface PortalOrderShape {
  id: string
  orderNumber: string
  portalSlug: string | null
  portalSunsetAt: Date | null
  status: string
  jobId: string
  company: { id: string; name: string }
}

const PORTAL_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  portalSlug: true,
  portalSunsetAt: true,
  status: true,
  jobId: true,
  company: { select: { id: true, name: true } },
} as const

/**
 * The order this portal should actually speak for.
 *
 * A PortalAccess row is minted against ONE order, and nothing re-pointed it
 * when that order died. Rebuilding an order is ordinary desk work — cancel
 * S260915-004, book S260915-005 with the same vans on the same day — and it
 * left the client reading the cancelled row: a cancelled total, a progress
 * tracker stuck at stage 0, and every write they could make (approve the
 * quote, sign the agreement, drop a COI, name a driver) landing on a dead
 * order. Wrong Number / SR-JOB-0273, Wes 2026-09-15.
 *
 * So the session follows, under the same rule `assignUnit` uses for units:
 * with exactly ONE live order left on the job it is unambiguous. With none,
 * or with more than one, we serve the order the link names and the portal
 * says out loud that it is cancelled — never a silent guess between two live
 * orders, which would show a client somebody else's rental.
 *
 * `jobSlugs` is every portal address on that job. The client's saved link and
 * their emailed link are different orders' slugs after a rebuild, and both
 * have to keep working — see the slug check in /api/portal/job/data.
 */
export async function resolvePortalOrder(
  linkOrder: PortalOrderShape,
  now: Date,
): Promise<{
  order: PortalOrderShape
  followedFrom: { id: string; orderNumber: string } | null
  jobSlugs: string[]
}> {
  const siblings = await prisma.order.findMany({
    where: { jobId: linkOrder.jobId, archivedAt: null },
    select: PORTAL_ORDER_SELECT,
  })
  const jobSlugs = siblings
    .map((o) => o.portalSlug)
    .filter((v): v is string => !!v)
  if (linkOrder.portalSlug && !jobSlugs.includes(linkOrder.portalSlug)) jobSlugs.push(linkOrder.portalSlug)

  if (!DEAD_ORDER_STATUSES.includes(linkOrder.status)) {
    return { order: linkOrder, followedFrom: null, jobSlugs }
  }

  const live = siblings.filter(
    (o) =>
      o.id !== linkOrder.id
      && !DEAD_ORDER_STATUSES.includes(o.status)
      // Never follow into a portal that has already sunset — that gate is
      // about the client's window closing, and following past it would
      // reopen a door someone deliberately shut.
      && !(o.portalSunsetAt && o.portalSunsetAt.getTime() < now.getTime()),
  )
  if (live.length !== 1) {
    return { order: linkOrder, followedFrom: null, jobSlugs }
  }
  return {
    order: live[0],
    followedFrom: { id: linkOrder.id, orderNumber: linkOrder.orderNumber },
    jobSlugs,
  }
}

export interface ResolvedPortalAccess {
  portalAccessId: string
  /** The order the portal speaks for — followed past a dead one, see resolvePortalOrder. */
  orderId: string
  contactId: string
  contact: { id: string; firstName: string; lastName: string; email: string } | null
  order: PortalOrderShape
  /** The dead order the link was minted against, when we followed off it. */
  followedFrom: { id: string; orderNumber: string } | null
  /** Every portal address on this job — all of them stay valid for this session. */
  jobSlugs: string[]
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
 * Branded-send-flow portal link helper. Strict policy: ONE PortalAccess
 * row per (orderId, contactId).
 *
 *   - If any non-revoked row exists (whether the token is still live or
 *     already expired), keep that row's token and REFRESH its
 *     magicLinkExpiresAt to (now + LINK_TTL_DAYS). The same token URL
 *     keeps working — older emails that embedded it stay valid until
 *     the new expiry — and the newest send always carries a fresh
 *     7-day window.
 *   - If no non-revoked row exists, mint one via issueJobMagicLink.
 *
 * Net effect of the refresh-rather-than-reissue policy:
 *   - No audit-table bloat from repeated sends (quote + 3 follow-ups
 *     = one row, not four).
 *   - No "two valid tokens for the same contact" surprise.
 *   - Older emails' embedded links keep working as long as the
 *     contact is still active on the order — the URL is opaque to
 *     the token's expiry timestamp.
 *
 * The other 4 issueJobMagicLink callers (manual invite, auto-on-
 * contact-add, authorize-token flow) keep their explicit "always mint
 * a new row" semantics — those are agent-driven actions where a new
 * row is the intent.
 */
export async function refreshOrIssueJobMagicLink(args: {
  orderId: string
  contactId: string
}): Promise<{ token: string; expiresAt: Date; portalAccessId: string; reused: boolean }> {
  const existing = await prisma.portalAccess.findFirst({
    where: {
      orderId: args.orderId,
      contactId: args.contactId,
      revokedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, magicLinkToken: true },
  })
  if (existing) {
    const newExpiresAt = new Date(Date.now() + LINK_TTL_DAYS * 86_400_000)
    await prisma.portalAccess.update({
      where: { id: existing.id },
      data: { magicLinkExpiresAt: newExpiresAt },
    })
    return {
      token: existing.magicLinkToken,
      expiresAt: newExpiresAt,
      portalAccessId: existing.id,
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
      order: { select: PORTAL_ORDER_SELECT },
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
  // First open → one line to HQ (Wes 2026-09-05). Counter read BEFORE the
  // bump above, so this fires exactly once per person and portal.
  if (row.accessCount === 0) {
    alertFirstPortalOpen({
      kind: 'job',
      personName: `${row.contact.firstName} ${row.contact.lastName}`.trim(),
      personEmail: row.contact.email,
      subject: row.order.company?.name ? `${row.order.company.name} · ${row.order.orderNumber}` : row.order.orderNumber,
      href: `/orders/${row.order.id}`,
    }).catch(() => {})
  }

  const resolved = await resolvePortalOrder(row.order, now)
  return {
    portalAccessId: row.id,
    orderId: resolved.order.id,
    contactId: row.contactId,
    contact: row.contact,
    order: resolved.order,
    followedFrom: resolved.followedFrom,
    jobSlugs: resolved.jobSlugs,
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
      order: { select: PORTAL_ORDER_SELECT },
    },
  })
  if (!row) return null
  if (row.revokedAt) return null
  if (!row.order) return null
  if (row.order.portalSunsetAt && row.order.portalSunsetAt.getTime() < now.getTime()) return null

  const resolved = await resolvePortalOrder(row.order, now)
  return {
    portalAccessId: row.id,
    orderId: resolved.order.id,
    contactId: row.contactId,
    contact: row.contact,
    order: resolved.order,
    followedFrom: resolved.followedFrom,
    jobSlugs: resolved.jobSlugs,
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
