/**
 * POST /api/crm/companies/[id]/agreements/[agreementId]/counsel-review
 *
 * Email the client's COUNSEL a read-only link to their negotiated agreement
 * (Wes 2026-09-18: "I'll need to send my finished one to him. Ideally, I can
 * just send it in HQ to him").
 *
 * Posture, copied from the COI broker desk deliberately:
 *  - The EMAIL IS THE ACT. A send failure changes nothing; nothing is
 *    stamped on the agreement, because a link that went nowhere is not a
 *    round of negotiation.
 *  - **The LINK is appended by THIS ROUTE, never by the editable draft** —
 *    the partner-welcome rule. Someone trimming a paragraph must not be
 *    able to delete the thing the email exists to deliver.
 *  - **NO Cc** (Wes: "no cc"). The COI rule Cc's the client because nobody's
 *    broker should be approached behind their coordinator's back. Counsel is
 *    different: this is Wes writing to the lawyer he has been negotiating
 *    with, and copying a production coordinator on it is the wrong instinct.
 *    The box is free for a human to add one.
 *  - Reply-To is the SENDER, exact, so the markup comes back to a person and
 *    not to notifications@.
 *  - Audited with WHO it went to, never the body.
 *  - **A GET is the REVIEW** (Wes 2026-09-18: "Where is the review of the
 *    email to Marell?"). The first cut composed the body inside the POST, so
 *    the only thing on screen before sending was the note box — for the one
 *    message in HQ most worth reading twice, going to the client's lawyer.
 *    Preview and send both call `renderCounselReviewEmail`, so the preview
 *    IS the mail (the partner-welcome rule). The GET mints its own display
 *    token; the POST mints the one that is sent. Both are valid for the same
 *    agreement, so the preview is honest about what the link does even
 *    though the string differs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { signCounselReviewToken, counselReviewUrl } from '@/lib/contracts/counselReviewToken'
import { buildCounselReviewPacket } from '@/lib/contracts/counselReviewPacket'
import {
  renderCounselReviewEmail,
  defaultCounselReviewBody,
} from '@/lib/contracts/counselReviewEmail'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * GET — the REVIEW. Renders exactly what the POST will send, for the same
 * inputs, through the same renderer. Sends nothing, stamps nothing, and
 * audits nothing: reading a draft is not an act.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; agreementId: string } },
) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const packet = await buildCounselReviewPacket(params.agreementId)
  if (!packet) {
    return NextResponse.json(
      {
        error: 'That agreement has no negotiated document on file.',
        fix: 'This link only works for an agreement whose clauses are in the registry.',
      },
      { status: 409 },
    )
  }
  const agreementRow = await prisma.companyAgreement.findFirst({
    where: { id: params.agreementId, companyId: params.id, deletedAt: null },
    select: { id: true },
  })
  if (!agreementRow) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const sender = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { name: true, email: true },
  })
  const sp = req.nextUrl.searchParams
  const name = sp.get('name')?.trim() || null
  const message = sp.get('message')?.trim() || null

  const url = counselReviewUrl(signCounselReviewToken({ companyAgreementId: packet.companyAgreementId }))
  const mail = renderCounselReviewEmail({
    packet,
    url,
    senderName: sender?.name || 'Wes Bailey',
    recipientName: name,
    message,
  })

  return NextResponse.json({
    ok: true,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    // What the send will put in the headers, so the review shows the whole
    // envelope and not just the body. No Cc, by design.
    from: 'SirReel HQ',
    replyTo: sender?.email || 'wes@sirreel.com',
    cc: [],
    reviewUrl: url,
    // The standard wording, so the panel can show what a blank note sends.
    defaultBody: defaultCounselReviewBody(packet),
    document: {
      title: packet.title,
      companyName: packet.companyName,
      isCurrentDraft: packet.isCurrentDraft,
    },
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; agreementId: string } },
) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    email?: unknown
    name?: unknown
    message?: unknown
  }
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'A valid email address for their counsel is required.' }, { status: 400 })
  }
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : null
  const message =
    typeof body.message === 'string' && body.message.trim() ? body.message.trim().slice(0, 4000) : null

  const packet = await buildCounselReviewPacket(params.agreementId)
  if (!packet) {
    return NextResponse.json(
      {
        error: 'That agreement has no negotiated document on file.',
        fix: 'This link only works for an agreement whose clauses are in the registry — the Word copy is composed from that text rather than converted from a PDF.',
      },
      { status: 409 },
    )
  }

  const agreementRow = await prisma.companyAgreement.findFirst({
    where: { id: params.agreementId, companyId: params.id, deletedAt: null },
    select: { id: true },
  })
  if (!agreementRow) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const sender = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true },
  })

  const url = counselReviewUrl(signCounselReviewToken({ companyAgreementId: packet.companyAgreementId }))
  const mail = renderCounselReviewEmail({
    packet,
    url,
    senderName: sender?.name || 'Wes Bailey',
    recipientName: name,
    message,
  })

  const sent = await sendAgreementEmail({
    to: [email],
    replyTo: sender?.email || 'wes@sirreel.com',
    replyToExact: true,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    label: 'counsel-agreement-review',
  }).catch((e) => {
    console.error('[counsel-review] send failed:', e)
    return null
  })

  await prisma.auditLog.create({
    data: {
      action: 'company_agreement.counsel_review_sent',
      entityType: 'CompanyAgreement',
      entityId: packet.companyAgreementId,
      userId: sender?.id ?? undefined,
      // WHO it went to and whether it left — never the body, which is the
      // negotiation and belongs in the thread, not the audit log.
      newValues: {
        to: email,
        name,
        companyName: packet.companyName,
        customMessage: !!message,
        delivered: !!sent,
      },
    },
  }).catch(() => null)

  if (!sent) {
    return NextResponse.json(
      { error: 'The email could not be sent.', fix: 'Check the address and try again — nothing was recorded as delivered.' },
      { status: 502 },
    )
  }
  return NextResponse.json({ ok: true, to: email, url })
}
