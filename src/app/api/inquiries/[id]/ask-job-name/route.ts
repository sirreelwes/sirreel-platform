/**
 * POST /api/inquiries/[id]/ask-job-name — email the client asking what
 * to call the production.
 *
 * Wes, 2026-08-29, looking at a Review Quote whose Job field was empty:
 * "we need a 'Ask client for job name' option."
 *
 * The alternative is what the book already shows: jobs called "TBD",
 * "QUOTE", "New Job" and "Untitled" — placeholder names invented at
 * quote time that nobody ever goes back and fixes, which then make every
 * job list and every search worse forever.
 *
 * ── Reuses the existing mechanism, deliberately ────────────────────
 *
 * The signed "tell us your company and project" link, its public form at
 * /details/[token], and the ClientDetailReply row it writes all already
 * exist — they were built for the Quick Reply email. The only thing
 * missing was a way to send that ask on its own, without composing a
 * whole reply. So this mints the same token, sends a short mail, and the
 * client's answer lands in the same place the existing UI already reads.
 *
 * Nothing here creates or renames a Job. The reply arrives as a
 * ClientDetailReply for a human to accept — the client's words are the
 * suggestion, not the write.
 *
 * ── This is the SEND half of a review gate (Wes 2026-09-02) ────────
 *
 * It used to be the whole thing: one click on Review Quote and the email
 * was gone, unreviewed. The copy now comes from composeAskJobNameEmail so
 * /preview renders the same words, and the rep sends from
 * EmailReviewModal like every other client-facing email in HQ.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { parseCcList } from '@/lib/email/ccList'
import { signDetailsToken, detailsLinkUrl } from '@/lib/intake/detailsToken'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { composeAskJobNameEmail, loadAskJobNameContext } from '@/lib/sales/askJobNameEmail'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  // Rep-typed CC from the review modal. Re-parsed server-side: the
  // client-side check is a convenience, not a control.
  const cc = parseCcList(body.ccAdd)

  let ctx
  try {
    ctx = await loadAskJobNameContext(id, user, body)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not compose the ask.'
    return NextResponse.json({ error: msg }, { status: msg === 'Inquiry not found' ? 404 : 400 })
  }

  let url: string
  try {
    url = detailsLinkUrl(
      signDetailsToken({
        inquiryId: ctx.inquiryId,
        sentTo: ctx.toEmail,
        ask: { company: ctx.askForCompany, project: true },
      }),
    )
  } catch (err) {
    console.error('[ask-job-name] token sign failed:', err)
    return NextResponse.json({ error: 'Could not create the link.' }, { status: 500 })
  }

  const customMessage =
    typeof body.customMessage === 'string' && body.customMessage.trim() ? body.customMessage : null
  const { subject, html, text } = composeAskJobNameEmail({ ctx, url, customMessage })

  const result = await sendAgreementEmail({
    to: [ctx.toEmail],
    cc: cc.length ? cc : undefined,
    subject,
    html,
    text,
    // Replies go to the rep who asked, not a shared inbox — they are the
    // one waiting on the answer.
    replyTo: user.email,
    label: `ask-job-name:${ctx.inquiryId}`,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? 'send failed' }, { status: 502 })
  }
  if (result.id) {
    await recordEmailDelivery({
      resendMessageId: result.id,
      toAddress: ctx.toEmail,
      ccAddresses: cc,
      subject,
      label: `ask-job-name:${ctx.inquiryId}`,
    })
  }

  return NextResponse.json({ ok: true, sentTo: ctx.toEmail, askedForCompany: ctx.askForCompany })
}
