/**
 * POST /api/portal/job/card-auth/share — the client hands the card
 * authorization to someone else on their side.
 *
 * Wes 2026-09-11, after Nancy (Happy Place accounting, SR-JOB-0351) could
 * not find the card form: "often the person who sends the credit card
 * isn't the production team client... make sure it's easy for clients to
 * share this responsibility."
 *
 * The person named here gets THREE things, in one call:
 *   1. The card-authorization email HQ would have sent, with the same
 *      secure link (the job's PaperworkRequest token, opened on the card
 *      step) — written as a handoff from the colleague, not a cold ask.
 *   2. A seat on the job: a JobContact (ACCOUNTING) so HQ's recipient
 *      ranking, the collections desk and the job page all know who holds
 *      the money side of this show.
 *   3. Their own job-portal link (PortalAccess), so they can see the quote,
 *      the agreement and the invoices they will be asked to pay — not just
 *      a card form in a vacuum.
 *
 * Body: { name?: string, email: string, note?: string }
 *
 * Refuses when the job has no card link yet (409) — minting one from the
 * client side would flip the card-required gate (cardGate.ts) on a job HQ
 * never asked about. The rep sends the first ask; the client can hand it
 * on from there.
 *
 * Rate-limited per portal access (a team, not a mailing list). Nothing is
 * revoked or overwritten: the original recipient keeps their link, and
 * `PaperworkRequest.sentTo` still names who HQ asked first.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession, refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobUrl, portalV2Url } from '@/lib/portal/portalUrl'
import { normalizeEmail, resolvePersonByEmail } from '@/lib/people/email'
import { isEmailAddress, splitPersonName } from '@/lib/portal/grantCompanyAccess'
import { buildCardAuthRequestEmail } from '@/lib/email/templates/cardAuthRequest'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { agentReplyTo } from '@/lib/email/teamVisibility'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { checkRateLimit } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

/** Five handoffs an hour per portal seat. */
const RATE = { windowMs: 60 * 60_000, max: 5 }

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return bad(401, 'No session')

  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ ok: false, error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const rl = checkRateLimit(`card-auth-share:${resolved.portalAccessId}`, RATE)
  if (!rl.ok) {
    return bad(429, "That's a few handoffs in a short time — try again in a while, or ask your rep.")
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown
    email?: unknown
    note?: unknown
  }
  if (!isEmailAddress(body.email)) return bad(400, 'Enter a valid email address.')
  const email = normalizeEmail(body.email)
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 600) : ''
  if (resolved.contact && normalizeEmail(resolved.contact.email) === email) {
    return bad(400, "That's you — open the card form from the button above instead.")
  }

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: {
      id: true,
      orderNumber: true,
      portalSlug: true,
      bookingId: true,
      jobId: true,
      company: { select: { id: true, name: true } },
      job: { select: { id: true, name: true, jobCode: true } },
      agent: { select: { name: true, email: true } },
    },
  })
  if (!order || !order.jobId || !order.job) return bad(404, 'Order not found')
  const jobId = order.jobId

  // The same resolution the portal page used to show the row: a row that
  // already holds a card wins, then this order's booking, then the newest
  // on any live booking of the job (a rebook orphans Order.bookingId).
  const scopes: Prisma.PaperworkRequestWhereInput[] = [
    { booking: { jobId, status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null } },
  ]
  if (order.bookingId) scopes.unshift({ bookingId: order.bookingId })
  const requests = await prisma.paperworkRequest.findMany({
    where: { OR: scopes },
    orderBy: { sentAt: 'desc' },
    select: { id: true, token: true, bookingId: true, ccCardNumberEncrypted: true },
  })
  const pr =
    requests.find((r) => !!r.ccCardNumberEncrypted) ??
    requests.find((r) => r.bookingId === order.bookingId) ??
    requests[0] ??
    null
  if (!pr) {
    return bad(
      409,
      'No card authorization link has been issued for this job yet — your rep sends the first one, and you can hand it on from here after that.',
    )
  }

  // Person: alias-aware lookup first, so a merged old address lands on the
  // survivor; otherwise mint one, affiliated with the company so they show
  // on the CRM page as a contact and not only inside the portal.
  const existing = (await resolvePersonByEmail(email, {
    select: { id: true, firstName: true, lastName: true },
  })) as { id: string; firstName: string; lastName: string } | null
  let personId = existing?.id ?? null
  let firstName = existing?.firstName ?? ''
  if (!personId) {
    const split = splitPersonName(name, email)
    const person = await prisma.person.create({
      data: { firstName: split.first, lastName: split.last, email, source: 'portal_card_handoff' },
      select: { id: true, firstName: true },
    })
    personId = person.id
    firstName = person.firstName
    if (order.company?.id) {
      await prisma.affiliation
        .create({ data: { personId, companyId: order.company.id, isCurrent: true } })
        .catch(() => null)
    }
  }

  // A seat on the job. One row per person is enough — someone already on
  // the roster as PM does not gain a second ACCOUNTING row.
  const onJob = await prisma.jobContact.findFirst({
    where: { jobId, personId },
    select: { id: true },
  })
  let addedToJob = false
  if (!onJob) {
    await prisma.jobContact.create({ data: { jobId, personId, role: 'ACCOUNTING' } })
    addedToJob = true
  }

  // Their own way into the job portal. One PortalAccess per (order,
  // contact); an existing seat just gets its expiry refreshed.
  let jobPortalUrl: string | null = null
  if (order.portalSlug) {
    const issued = await refreshOrIssueJobMagicLink({ orderId: order.id, contactId: personId })
    jobPortalUrl = portalJobUrl(order.portalSlug, issued.token)
  }

  const sharerName = resolved.contact
    ? `${resolved.contact.firstName} ${resolved.contact.lastName}`.trim()
    : order.company?.name ?? 'Your colleague'
  const companyName = order.company?.name ?? null
  const jobName = order.job.name ?? order.orderNumber
  const agentFirst = (order.agent?.name ?? '').split(/\s+/)[0] || null
  const greetName = firstName || email.split('@')[0]

  // The template's shell (secure-form paragraph, button, payment options,
  // sign-off) stays; only the ask is rewritten as a handoff.
  const customBody = [
    `Hi ${greetName},`,
    ``,
    `${sharerName}${companyName ? ` at ${companyName}` : ''} asked you to complete the card authorization for ${jobName} — it is the one piece of start paperwork still open on the job. The button below opens the secure form; it takes a minute, and nothing is charged by adding a card.`,
    ...(note ? [``, `From ${sharerName}: "${note}"`] : []),
    ...(jobPortalUrl
      ? [
          ``,
          `You also have your own view of the job — the quote, the rental agreement and the invoices as they arrive: ${jobPortalUrl}`,
        ]
      : []),
    ``,
    `Questions? Reply to this email and ${agentFirst ?? 'your SirReel rep'} will help.`,
  ].join('\n')

  const mail = buildCardAuthRequestEmail({
    firstName: greetName,
    jobName,
    portalLink: `${portalV2Url(pr.token)}?open=cc`,
    agentFirstName: agentFirst,
    customBody,
  })

  const sent = await sendAgreementEmail({
    to: [email],
    replyTo: agentReplyTo(order.agent?.email) ?? undefined,
    subject: `${sharerName} asked you to authorize a card for ${jobName}`,
    html: mail.html,
    text: mail.text,
    label: 'card-auth-handoff',
    orderId: order.id,
  })
  if (!sent.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `We could not send that email (${sent.reason}). Try again in a moment, or ask your rep to send the link.`,
      },
      { status: 502 },
    )
  }

  await prisma.auditLog
    .create({
      data: {
        action: 'card_auth.client_handoff',
        entityType: 'job',
        entityId: jobId,
        newValues: {
          byPortalAccessId: resolved.portalAccessId,
          byName: sharerName,
          byEmail: resolved.contact?.email ?? null,
          toPersonId: personId,
          toEmail: email,
          addedToJob,
          paperworkRequestId: pr.id,
          orderId: order.id,
        },
      },
    })
    .catch(() => null)

  const hq = await channelRecipients('portal-people').catch(() => [] as string[])
  if (hq.length > 0) {
    const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
    const line = `${sharerName}${companyName ? ` (${companyName})` : ''} handed the card authorization for ${jobName} (${order.job.jobCode}) to ${name || email} <${email}> from the job portal.${addedToJob ? ' They were added to the job as the accounting contact and sent their own portal link.' : ''}`
    await sendAgreementEmail({
      to: hq,
      subject: `${sharerName} handed the card authorization for ${jobName} to ${name || email}`,
      html: `<p>${line}</p><p><a href="${base}/jobs/${jobId}">${base}/jobs/${jobId}</a></p>`,
      text: `${line}\n\n${base}/jobs/${jobId}`,
      label: 'card-auth-handoff-hq',
    }).catch(() => null)
  }

  return NextResponse.json({
    ok: true,
    email,
    name: name || firstName || null,
    addedToJob,
    portalIssued: !!jobPortalUrl,
  })
}
