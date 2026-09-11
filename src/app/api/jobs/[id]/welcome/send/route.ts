/**
 * POST /api/jobs/[id]/welcome/send — the real send behind the job page's
 * "Send welcome email" button (and the reminder on the /jobs tile).
 *
 * Same shape as the paperwork-summary send: compose once to learn WHO
 * (ranking lives in composeJobWelcomeEmail), mint that contact's job-page
 * link on the job's portal order, compose again with the live link, send,
 * record the delivery, and stamp `job.welcome_sent` on the job — which is
 * the fact the tile and the button read to stop reminding.
 *
 * No client job page yet (no live order with a portalSlug) → 409. The
 * welcome IS the link; without one there is nothing to send.
 *
 * Body (optional): { customMessage?, overrideContactId?, ccAdd? }
 * Auth: session-gated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { composeJobWelcomeEmail } from '@/lib/email/preview/composeJobWelcomeEmail'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobUrl } from '@/lib/portal/portalUrl'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { parseCcList } from '@/lib/email/ccList'
import { agentReplyTo, withTeamCc } from '@/lib/email/teamVisibility'
import { WELCOME_SENT_ACTION } from '@/lib/jobs/welcomeReminder'

export const dynamic = 'force-dynamic'

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const body = await req.json().catch(() => ({}))
  const customMessage =
    typeof body?.customMessage === 'string' && body.customMessage.trim().length > 0
      ? body.customMessage.trim().slice(0, 5000)
      : null
  const overrideContactId =
    typeof body?.overrideContactId === 'string' ? body.overrideContactId : null
  const manualCc = parseCcList(body?.ccAdd)

  // Pass 1 — who is this going to, and is there a job page to link?
  const resolved = await composeJobWelcomeEmail({
    jobId: params.id,
    customMessage,
    overrideContactId,
    portalLink: null,
  })
  if (!resolved.ok) return bad(resolved.status, resolved.error)
  if (!resolved.portalOrder) {
    return bad(
      409,
      'This job has no client job page yet — send the quote first; the welcome is the link to it.',
    )
  }

  const link = await refreshOrIssueJobMagicLink({
    orderId: resolved.portalOrder.id,
    contactId: resolved.to.id,
  })
  const portalLink = portalJobUrl(resolved.portalOrder.portalSlug, link.token)

  // Pass 2 — the same recipient, now with a live button.
  const composition = await composeJobWelcomeEmail({
    jobId: params.id,
    customMessage,
    overrideContactId: resolved.to.id,
    portalLink,
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
    label: 'job-welcome',
    orderId: resolved.portalOrder.id,
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: `Email not sent — ${result.reason}` }, { status: 502 })
  }

  if (result.id) {
    await recordEmailDelivery({
      resendMessageId: result.id,
      toAddress: composition.to.email,
      subject: composition.subject,
      label: 'job-welcome',
      orderId: resolved.portalOrder.id,
    }).catch((e) => console.error('[job-welcome] delivery record failed', e))
  }

  // The fact the tile and the button read. Never a column: the send is a
  // moment, and a re-send is just a newer row.
  await prisma.auditLog
    .create({
      data: {
        userId: null,
        action: WELCOME_SENT_ACTION,
        entityType: 'Job',
        entityId: params.id,
        newValues: {
          sentBy: session.user.email,
          to: composition.to.email,
          cc,
          subject: composition.subject,
          orderId: resolved.portalOrder.id,
        },
      },
    })
    .catch((e) => console.error('[job-welcome] audit failed', e))

  return NextResponse.json({
    ok: true,
    recipient: composition.to.email,
    cc,
    portalLink,
    orderNumber: composition.order.orderNumber,
  })
}
