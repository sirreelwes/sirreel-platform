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
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { signDetailsToken, detailsLinkUrl } from '@/lib/intake/detailsToken'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'

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
  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      person: { select: { firstName: true, email: true } },
      company: { select: { name: true } },
    },
  })
  if (!inquiry) return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as {
    toEmail?: unknown
    toName?: unknown
    askForCompany?: unknown
  } | null

  // The caller may pass the recipient explicitly — on Review Quote the
  // contact often is not saved yet, so there is no Person row to read.
  const toEmail =
    (typeof body?.toEmail === 'string' && body.toEmail.trim()) || inquiry.person?.email || ''
  if (!toEmail) {
    return NextResponse.json(
      { error: 'No client email on this inquiry — add a contact first.' },
      { status: 400 },
    )
  }
  const toName =
    (typeof body?.toName === 'string' && body.toName.trim()) || inquiry.person?.firstName || 'there'
  // Ask for the company too when we do not have one yet — same trip.
  const askForCompany = body?.askForCompany === true || !inquiry.company

  let url: string
  try {
    url = detailsLinkUrl(
      signDetailsToken({
        inquiryId: inquiry.id,
        sentTo: toEmail,
        ask: { company: askForCompany, project: true },
      }),
    )
  } catch (err) {
    console.error('[ask-job-name] token sign failed:', err)
    return NextResponse.json({ error: 'Could not create the link.' }, { status: 500 })
  }

  const agent = user.name || 'the SirReel team'
  const wanted = askForCompany ? 'the production name and your company' : 'the production name'
  const subject = `Quick one — what should we call this job?`
  const text =
    `Hi ${toName},\n\n` +
    `We're putting your quote together. So it lands in the right place, could you tell us ` +
    `${wanted}?\n\n${url}\n\n` +
    `Takes a few seconds — or just reply to this email and we'll add it.\n\n` +
    `Thanks,\n${agent}\nSirReel Production Vehicles`
  const html =
    `<div style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1c1917">` +
    `<p>Hi ${toName},</p>` +
    `<p>We're putting your quote together. So it lands in the right place, could you tell us ${wanted}?</p>` +
    `<p><a href="${url}" style="color:#b45309;font-weight:700">Add ${askForCompany ? 'them' : 'it'} here</a> — takes a few seconds, or just reply to this email and we'll add it.</p>` +
    `<p>Thanks,<br>${agent}<br>SirReel Production Vehicles</p></div>`

  const result = await sendAgreementEmail({
    to: [toEmail],
    subject,
    html,
    text,
    // Replies go to the rep who asked, not a shared inbox — they are the
    // one waiting on the answer.
    replyTo: user.email,
    label: `ask-job-name:${inquiry.id}`,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? 'send failed' }, { status: 502 })
  }
  if (result.id) {
    await recordEmailDelivery({
      resendMessageId: result.id,
      toAddress: toEmail,
      subject,
      label: `ask-job-name:${inquiry.id}`,
    })
  }

  return NextResponse.json({ ok: true, sentTo: toEmail, askedForCompany: askForCompany })
}
