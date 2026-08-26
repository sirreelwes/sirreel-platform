/**
 * POST /api/jobs/[id]/card-auth/send — the real send behind the job
 * page's Card Authorization tile.
 *
 * Replaces the old mint-and-copy-to-clipboard behaviour of
 * /api/jobs/[id]/cc-request-link, which sent no email at all: the button
 * said "Send CC request", copied a URL, and left no record anywhere, so
 * "did the client ever get asked?" was unanswerable (Wes 2026-08-26).
 *
 * Order of operations matters. The PaperworkRequest token is minted
 * BEFORE the compose so the email carries a live link, but `sentTo` /
 * `sentAt` are only stamped AFTER Resend accepts — a failed send must not
 * leave a row claiming the client was asked. A token minted by a failed
 * send is harmless: the next attempt reuses it.
 *
 * A Resend failure returns { ok: false, error } with a 502, which is what
 * EmailReviewModal renders in its error strip. That is the whole point of
 * this route existing — the agent finds out.
 *
 * Body (optional): { message?, overrideContactId?, ccAdd? }
 * Auth: session-gated (no role gate — collections chases cards too).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import {
  composeCardAuthEmail,
  resolveCardAuthBookingId,
} from '@/lib/email/preview/composeCardAuthEmail'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { parseCcList } from '@/lib/email/ccList'
import { agentReplyTo, withTeamCc } from '@/lib/email/teamVisibility'
import { portalV2Url } from '@/lib/portal/portalUrl'

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
  const overrideContactId =
    typeof body?.overrideContactId === 'string' ? body.overrideContactId : null
  // Re-parsed server-side; the modal's own check is a convenience.
  const manualCc = parseCcList(body?.ccAdd)

  const bookingId = await resolveCardAuthBookingId(params.id)
  if (!bookingId) {
    return bad(409, 'No reservation on this job yet — add one before requesting a card.')
  }

  // Reuse the booking's PaperworkRequest if one exists; otherwise mint.
  // `sentTo` starts empty and is filled in below only on a real send, so a
  // freshly minted row never claims an ask that didn't happen.
  let pr = await prisma.paperworkRequest.findFirst({
    where: { bookingId },
    orderBy: { sentAt: 'desc' },
    select: { id: true, token: true },
  })
  if (!pr) {
    pr = await prisma.paperworkRequest.create({
      data: { bookingId, sentTo: '' },
      select: { id: true, token: true },
    })
  }

  const portalLink = portalV2Url(pr.token)

  const composition = await composeCardAuthEmail({
    jobId: params.id,
    message,
    overrideContactId,
    portalLink,
  })
  if (!composition.ok) return bad(composition.status, composition.error)

  const cc = withTeamCc(manualCc, composition.to.email)

  const result = await sendAgreementEmail({
    to: [composition.to.email],
    cc: cc.length ? cc : undefined,
    replyTo: agentReplyTo(session.user.email) ?? undefined,
    subject: composition.subject,
    html: composition.html,
    text: composition.text,
    label: 'card-auth-request',
    orderId: composition.orderId,
  })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: `Email not sent — ${result.reason}` },
      { status: 502 },
    )
  }

  await prisma.paperworkRequest.update({
    where: { id: pr.id },
    data: { sentTo: composition.to.email, sentAt: new Date() },
  })

  return NextResponse.json({
    ok: true,
    recipient: composition.to.email,
    cc,
    portalLink,
  })
}
