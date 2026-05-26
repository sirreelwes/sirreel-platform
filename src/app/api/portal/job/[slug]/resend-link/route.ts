/**
 * POST /api/portal/job/[slug]/resend-link — public, unauthenticated.
 *
 * Triggered by the "Email me a secure link" button on the portal error
 * page (no-token or expired-token states). Never dead-ends a client:
 * any client who reaches the portal URL with a slug we recognize gets
 * a fresh magic link emailed to the canonical recipient — even if they
 * arrived with no token at all.
 *
 * Recipient selection:
 *   - Preferred: most-recent non-revoked PortalAccess for the order
 *     (whoever was sent the link in the past). Refresh that row's
 *     magicLinkExpiresAt and reuse its token.
 *   - Fallback when no PortalAccess exists yet: rankRecipients() on
 *     the order's JobContacts + Order.jobContact override, same logic
 *     as the send routes. Mint a new PortalAccess for the resolved
 *     contact via refreshOrIssueJobMagicLink (will hit the issue path
 *     since none exists).
 *
 * Security:
 *   - Rate-limited per-IP via the existing publicRateLimit helper
 *     (default 5 / 10 min). Steal pattern from the supply-request
 *     endpoint.
 *   - Always returns { ok: true } regardless of outcome — does NOT
 *     echo the recipient email, does NOT distinguish "slug found / not
 *     found", does NOT report mint success. Prevents enumeration of
 *     valid portal slugs and prevents leaking which slugs have which
 *     contacts attached.
 *   - Failures (slug unknown / no recipient resolvable / email send
 *     failed) are logged server-side, surfaced as the same 200 to the
 *     client. Slow path; not hot.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildPortalInviteEmail } from '@/lib/email/templates/portalInvite'

export const dynamic = 'force-dynamic'

const PORTAL_HOST = 'https://hq.sirreel.com'

interface Recipient {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string | null
  isPrimary: boolean
}

/**
 * Same canonical-recipient logic as send-quote / Mode A follow-up
 * send. PRODUCER > primary > PM > PC > any-with-role > jobContact
 * override. Returns null if no recipient is resolvable.
 */
function rankAndPickRecipient(
  jobContacts: {
    role: string
    isPrimary: boolean
    person: { id: string; firstName: string; lastName: string; email: string }
  }[],
  jobContact: { id: string; firstName: string; lastName: string; email: string } | null,
): Recipient | null {
  const all: Recipient[] = []
  const seen = new Set<string>()
  const push = (
    id: string,
    firstName: string,
    lastName: string,
    email: string,
    role: string | null,
    isPrimary: boolean,
  ) => {
    if (!id || !email || seen.has(id)) return
    seen.add(id)
    all.push({ id, firstName, lastName, email, role, isPrimary })
  }
  for (const jc of jobContacts) {
    push(jc.person.id, jc.person.firstName, jc.person.lastName, jc.person.email, jc.role, !!jc.isPrimary)
  }
  if (jobContact) {
    push(jobContact.id, jobContact.firstName, jobContact.lastName, jobContact.email, null, false)
  }
  if (all.length === 0) return null
  const rank = (r: Recipient): number => {
    if (r.role === 'PRODUCER') return 0
    if (r.isPrimary) return 1
    if (r.role === 'PM') return 2
    if (r.role === 'PC') return 3
    if (r.role) return 4
    return 5
  }
  all.sort((a, b) => rank(a) - rank(b))
  return all[0]
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  // Always respond OK; do all work inside try so failures don't leak.
  const ok = () => NextResponse.json({ ok: true })

  try {
    const ip = clientIp(req)
    const rl = checkRateLimit(`portal-resend:${ip}`)
    if (!rl.ok) {
      // 429 is the only "tell" we surface — rate limit being hit isn't
      // sensitive info, and we want the client UI to back off.
      return NextResponse.json(
        { ok: false, error: 'rate_limited', retryAfterSeconds: rl.retryAfterSeconds },
        { status: 429 },
      )
    }

    const slug = params.slug
    if (!slug) return ok()

    // Resolve order by slug. portalSlug is unique on Order.
    const order = await prisma.order.findUnique({
      where: { portalSlug: slug },
      select: {
        id: true,
        orderNumber: true,
        portalSlug: true,
        portalSunsetAt: true,
        job: {
          select: {
            name: true,
            jobContacts: {
              select: {
                role: true,
                isPrimary: true,
                person: {
                  select: { id: true, firstName: true, lastName: true, email: true },
                },
              },
            },
          },
        },
        jobContact: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        agent: { select: { name: true, email: true, phone: true } },
      },
    })
    if (!order) return ok()
    if (order.portalSunsetAt && order.portalSunsetAt.getTime() < Date.now()) return ok()

    // Step 1 — try to find the most-recent non-revoked PortalAccess
    // for this order (preferred recipient: whoever was sent the link
    // in the past).
    const existingAccess = await prisma.portalAccess.findFirst({
      where: { orderId: order.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        contactId: true,
        contact: { select: { firstName: true, lastName: true, email: true } },
      },
    })

    let contactId: string | null = null
    let recipient: { firstName: string; lastName: string; email: string } | null = null

    if (existingAccess && existingAccess.contact) {
      contactId = existingAccess.contactId
      recipient = existingAccess.contact
    } else {
      // Step 2 — fallback: canonical recipient from rankRecipients.
      const picked = rankAndPickRecipient(order.job?.jobContacts ?? [], order.jobContact)
      if (picked) {
        contactId = picked.id
        recipient = { firstName: picked.firstName, lastName: picked.lastName, email: picked.email }
      }
    }

    if (!contactId || !recipient) return ok()

    // Refresh-or-issue keeps the one-row policy: if a PortalAccess
    // existed in Step 1, this refreshes its expiresAt. If we fell
    // through to Step 2, this mints a new row for the canonical
    // contact.
    const link = await refreshOrIssueJobMagicLink({ orderId: order.id, contactId })
    const portalUrl = `${PORTAL_HOST}/portal/job/${order.portalSlug}?token=${encodeURIComponent(link.token)}`

    const projectName = order.job?.name || order.orderNumber
    const tpl = buildPortalInviteEmail({
      firstName: recipient.firstName,
      projectName,
      portalLink: portalUrl,
      repName: order.agent?.name || 'the SirReel team',
      repPhone: order.agent?.phone || null,
      repEmail: order.agent?.email || null,
    })

    // Fire-and-don't-block. Resend failures are logged but we still
    // respond ok — failing loudly would tell an attacker their slug
    // attempt mapped to a real order.
    void sendAgreementEmail({
      label: `portal/resend-link:${order.orderNumber}`,
      to: [recipient.email],
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    }).catch((err) => {
      console.warn('[portal/resend-link] send failed:', err)
    })

    return ok()
  } catch (err) {
    console.warn('[portal/resend-link] handler error:', err)
    return ok()
  }
}
