/**
 * POST /api/jobs/[id]/paperwork-summary/send — the real send behind the
 * job page's "Send summary" button on the Paperwork strip.
 *
 * Order of operations matters, and it is the reverse of the card-auth
 * route's. There the token is job-scoped, so it can be minted first; here
 * the client's job-page link is issued PER CONTACT, so the recipient has
 * to be resolved before there is anything to mint. That is why the
 * composer runs twice: once with no links to learn who this is going to
 * (ranking lives in ONE place — see composePaperworkSummaryEmail), then
 * again with the minted destinations so every outstanding row carries a
 * live button. The second call pins `overrideContactId` to the first
 * call's answer, so the two can't pick different people.
 *
 * Link surface, in preference order:
 *   1. The client's job page (/portal/job/<slug>?token=) — the only
 *      surface with a paperwork section, a drivers section and an LCDW
 *      screen to deep-link into.
 *   2. The v2 paperwork portal, for a job that has no order with a portal
 *      yet (a hold placed before the quote). One screen, no anchors, so
 *      every row points at its home.
 *
 * A Resend failure returns { ok: false, error } with a 502 — the agent
 * finds out, which is the point of the route existing.
 *
 * Body (optional): { message?, customMessage?, overrideContactId?, ccAdd? }
 * Auth: session-gated (no role gate — collections chases paperwork too).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import {
  composePaperworkSummaryEmail,
  type PaperworkSummaryLinks,
} from '@/lib/email/preview/composePaperworkSummaryEmail'
import { ensureJobPaperworkBooking } from '@/lib/paperwork/ensurePaperworkBooking'
import { adoptJobPaperworkRequest } from '@/lib/paperwork/livePaperworkBooking'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobLcdwUrl, portalJobUrl, portalV2Url } from '@/lib/portal/portalUrl'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { parseCcList } from '@/lib/email/ccList'
import { agentReplyTo, withTeamCc } from '@/lib/email/teamVisibility'

export const dynamic = 'force-dynamic'

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const body = await req.json().catch(() => ({}))
  const message =
    typeof body?.message === 'string' && body.message.trim().length > 0
      ? body.message.trim().slice(0, 5000)
      : null
  const customMessage =
    typeof body?.customMessage === 'string' && body.customMessage.trim().length > 0
      ? body.customMessage.trim().slice(0, 5000)
      : null
  const overrideContactId =
    typeof body?.overrideContactId === 'string' ? body.overrideContactId : null
  // Re-parsed server-side; the modal's own check is a convenience.
  const manualCc = parseCcList(body?.ccAdd)

  // Pass 1 — who is this going to? No writes, no links.
  const resolved = await composePaperworkSummaryEmail({
    jobId: params.id,
    message,
    customMessage,
    overrideContactId,
    links: null,
  })
  if (!resolved.ok) return bad(resolved.status, resolved.error)

  // Mint the client's destinations for THAT contact.
  const portalOrder = await prisma.order.findFirst({
    where: { jobId: params.id, status: { not: 'CANCELLED' }, portalSlug: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, portalSlug: true },
  })

  let links: PaperworkSummaryLinks
  if (portalOrder?.portalSlug) {
    const link = await refreshOrIssueJobMagicLink({
      orderId: portalOrder.id,
      contactId: resolved.to.id,
    })
    links = {
      home: portalJobUrl(portalOrder.portalSlug, link.token),
      jobPage: true,
      lcdw: portalJobLcdwUrl(portalOrder.portalSlug, link.token),
    }
  } else {
    // No client job page yet. The paperwork portal still lets them sign,
    // drop a certificate and authorize a card — the send route creates the
    // booking it hangs off, exactly as the card-auth route does.
    const ensured = await ensureJobPaperworkBooking(params.id)
    if (!ensured.ok) return bad(409, ensured.error)
    let pr = await adoptJobPaperworkRequest(params.id, ensured.bookingId)
    if (!pr) {
      pr = await prisma.paperworkRequest.create({
        data: { bookingId: ensured.bookingId, sentTo: '' },
        select: { id: true, token: true },
      })
    }
    links = { home: portalV2Url(pr.token), jobPage: false, lcdw: null }
  }

  // Pass 2 — the same recipient, now with live buttons on every row.
  const composition = await composePaperworkSummaryEmail({
    jobId: params.id,
    message,
    customMessage,
    overrideContactId: resolved.to.id,
    links,
  })
  if (!composition.ok) return bad(composition.status, composition.error)

  const cc = await withTeamCc(manualCc, composition.to.email)

  const result = await sendAgreementEmail({
    to: [composition.to.email],
    cc: cc.length ? cc : undefined,
    replyTo: agentReplyTo(session.user.email) ?? undefined,
    subject: composition.subject,
    html: composition.html,
    text: composition.text,
    label: 'paperwork-summary',
    orderId: composition.orderId ?? undefined,
  })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: `Email not sent — ${result.reason}` },
      { status: 502 },
    )
  }

  if (result.id && composition.orderId) {
    await recordEmailDelivery({
      resendMessageId: result.id,
      toAddress: composition.to.email,
      subject: composition.subject,
      label: 'paperwork-summary',
      orderId: composition.orderId,
    }).catch((e) => console.error('[paperwork-summary] delivery record failed', e))
  }

  // What went out, and what it asked for. No new column for this: the
  // send is a fact about a moment, and the strip's own tiles remain the
  // live answer to "where does the paperwork stand".
  await prisma.auditLog
    .create({
      data: {
        userId: null,
        action: 'job.paperwork_summary_sent',
        entityType: 'Job',
        entityId: params.id,
        newValues: {
          sentBy: session.user.email,
          to: composition.to.email,
          cc,
          subject: composition.subject,
          outstanding: composition.summary.outstanding.map((i) => i.key),
        },
      },
    })
    .catch((e) => console.error('[paperwork-summary] audit failed', e))

  return NextResponse.json({
    ok: true,
    recipient: composition.to.email,
    cc,
    portalLink: links.home,
    outstanding: composition.summary.outstanding.length,
  })
}
