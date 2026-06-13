import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAuthorizeToken } from '@/lib/portal/authorizeToken'
import { issueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildPortalInviteEmail } from '@/lib/email/templates/portalInvite'
import { portalJobUrl } from '@/lib/portal/portalUrl'
import { normalizeEmail, resolvePersonByEmail } from '@/lib/people/email'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/authorize/[token]?action=approve|decline
 *
 * Click-through handler for the multi-contact authorization email. The
 * existing contact clicks [Yes] or [No]; this endpoint:
 *   - verifies the signed token (HMAC + exp)
 *   - on approve: find-or-creates the new Person, mints a PortalAccess on
 *     the order, emails the new contact their magic link
 *   - on decline: records nothing (intentionally — no persistent state for
 *     "declined") and returns the friendly page
 *
 * Returns minimal HTML responses rather than JSON since the click comes
 * from an email client, not the SPA.
 */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action') || ''
  const payload = verifyAuthorizeToken(decodeURIComponent(params.token))
  if (!payload) {
    return htmlResponse({
      title: 'Link expired',
      body: 'This authorization link has expired. Please ask your SirReel rep to send a fresh one.',
    })
  }
  if (action !== 'approve' && action !== 'decline') {
    return htmlResponse({
      title: 'Invalid action',
      body: 'Action must be approve or decline.',
    })
  }

  const order = await prisma.order.findUnique({
    where: { id: payload.orderId },
    select: {
      id: true,
      portalSlug: true,
      job: { select: { name: true } },
      company: { select: { name: true } },
      agent: { select: { name: true, email: true, phone: true } },
    },
  })
  if (!order || !order.portalSlug) {
    return htmlResponse({
      title: 'Job not available',
      body: "We couldn't find the project this link refers to. Reply to the email or call your rep.",
    })
  }

  if (action === 'decline') {
    return htmlResponse({
      title: 'Got it',
      body: `Thanks for letting us know. We won't share the ${order.job?.name || order.company?.name || 'project'} portal with that address.`,
    })
  }

  // Approve path: find-or-create the new Person and mint access.
  // This was the original site of the "Wes@" vs "wes@" dupe — the
  // magic-link flow stored "Wes@", the capture pipeline already had
  // "wes@", and Person.email's @unique didn't catch the case split.
  // Normalize on write + go through the alias-aware resolver so an
  // already-merged loser email lands on the survivor.
  const newEmail = normalizeEmail(payload.newEmail)
  const newFirst = payload.newFirstName || newEmail.split('@')[0]
  const newLast = payload.newLastName || '—'
  const existingPerson = await resolvePersonByEmail(newEmail, {
    select: { id: true, firstName: true, lastName: true, email: true },
  }) as { id: string; firstName: string; lastName: string; email: string } | null
  const newPerson = existingPerson ?? await prisma.person.create({
    data: { email: newEmail, firstName: newFirst, lastName: newLast },
    select: { id: true, firstName: true, lastName: true, email: true },
  })

  // Don't double-issue if there's already an active access.
  const existingAccess = await prisma.portalAccess.findFirst({
    where: { orderId: order.id, contactId: newPerson.id, revokedAt: null },
    select: { id: true },
  })
  let portalUrl: string
  if (existingAccess) {
    portalUrl = portalJobUrl(order.portalSlug)
  } else {
    const issued = await issueJobMagicLink({ orderId: order.id, contactId: newPerson.id })
    portalUrl = portalJobUrl(order.portalSlug, issued.token)
  }

  const jobLabel = order.job?.name || order.company?.name || ''
  const tpl = buildPortalInviteEmail({
    firstName: newPerson.firstName,
    projectName: jobLabel,
    portalLink: portalUrl,
    repName: order.agent?.name || 'the SirReel team',
    repPhone: order.agent?.phone || null,
    repEmail: order.agent?.email || null,
  })
  // Send the invite — best effort; the rep sees this same URL on the order
  // page anyway, so a delivery failure isn't critical to the approve action.
  await sendAgreementEmail({
    label: 'portal/authorize-approved-invite',
    to: [newPerson.email],
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  })

  return htmlResponse({
    title: 'Done — thanks',
    body: `${newPerson.firstName} ${newPerson.lastName} now has access to the ${jobLabel} portal. We sent them a link via email.`,
  })
}

function htmlResponse({ title, body }: { title: string; body: string }): Response {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; background:#f9fafb; color:#111827; margin:0; padding:48px 20px; text-align:center; }
  .card { max-width:480px; margin:0 auto; background:white; border-radius:16px; padding:32px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  h1 { font-size:22px; margin:0 0 12px; }
  p { font-size:14px; color:#374151; margin:0; line-height:1.6; }
</style>
</head><body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
