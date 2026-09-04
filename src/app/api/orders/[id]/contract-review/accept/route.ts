import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail, type EmailResult } from '@/lib/email/sendAgreementEmail'
import { portalJobUrl, portalTokenUrl } from '@/lib/portal/portalUrl'
import { pickCanonicalRecipient, rankRecipients } from '@/lib/email/recipients'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'
import { generateCounterPdf } from '@/lib/contracts/generateCounterPdf'
import { buildReviewPdfProps } from '@/lib/contracts/buildReviewPdfProps'

export const dynamic = 'force-dynamic'

/**
 * POST /api/orders/[id]/contract-review/accept
 *
 * Operator marks the ContractReview attached to this order's SignedAgreement as
 * the final negotiated version. Pre-condition: the operator has already
 * generated a counter-PDF on the review (so we have a concrete document to
 * point the client at). On success:
 *
 *   - SignedAgreement.documentType = NEGOTIATED
 *   - SignedAgreement.documentToSignUrl = contractReview.counterPdfUrl
 *   - SignedAgreement.status         = NEGOTIATED_READY
 *   - Client (job primary contact) gets an email with the paperwork-portal link
 *
 * The signing itself happens through the existing /agreement/sign endpoint;
 * that handler already branches on documentType=NEGOTIATED to land at
 * SIGNED_NEGOTIATED.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orderNumber: true,
      bookingId: true,
      portalSlug: true,
      company: { select: { name: true } },
      job: {
        select: {
          name: true,
          jobCode: true,
          jobContacts: {
            select: {
              role: true,
              isPrimary: true,
              person: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
        },
      },
      jobContact: { select: { id: true, email: true, firstName: true, lastName: true } },
      agent: { select: { email: true } },
      signedAgreements: {
        where: { contractType: 'RENTAL_AGREEMENT' },
        take: 1,
        select: {
          id: true,
          status: true,
          contractReviewId: true,
          contractReview: {
            select: { id: true, counterPdfUrl: true, counterPdfKey: true },
          },
        },
      },
    },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  const agreement = order.signedAgreements[0] ?? null
  if (!agreement) {
    return NextResponse.json(
      { error: 'Order has no SignedAgreement — nothing to accept' },
      { status: 404 },
    )
  }
  if (!agreement.contractReview) {
    return NextResponse.json(
      { error: 'SignedAgreement has no linked contract review — upload a redline first.' },
      { status: 409 },
    )
  }
  if (
    agreement.status !== 'REDLINE_UPLOADED' &&
    agreement.status !== 'UNDER_REVIEW' &&
    agreement.status !== 'NEGOTIATED_READY'
  ) {
    return NextResponse.json(
      {
        error: 'Agreement is not in a state that can be marked negotiated-ready',
        currentStatus: agreement.status,
      },
      { status: 409 },
    )
  }
  if (!agreement.contractReview.counterPdfUrl) {
    return NextResponse.json(
      {
        error:
          'Generate the counter-PDF on the contract review before accepting it as the final negotiated version.',
      },
      { status: 409 },
    )
  }

  // Render the DOCUMENT TO SIGN, distinct from the counter-proposal.
  //
  // Pointing documentToSignUrl straight at counterPdfUrl (what this route did
  // until 2026-09-04) asked clients to sign a page titled "Counter Proposal"
  // that closed with "It is a proposal for discussion and does not itself
  // constitute an executed contract." Same clauses, same decisions — the
  // finalized flag only changes the title and that closing paragraph — so the
  // client signs exactly what they were shown, under a document that admits
  // to being one.
  //
  // Best-effort: a render or upload failure falls back to the counter-PDF
  // rather than blocking the handoff, and says so in the response.
  let documentToSignUrl = agreement.contractReview.counterPdfUrl
  let finalizedPdf: 'rendered' | 'fell-back-to-counter' = 'fell-back-to-counter'
  try {
    const built = await buildReviewPdfProps(agreement.contractReview.id)
    if (built.ok) {
      const { counterPdfKey: _k, reviewId: _r, ...renderProps } = built.props
      const pdfBytes = await generateCounterPdf({
        ...renderProps,
        generatedAt: new Date(),
        finalized: true,
      })
      const now = new Date()
      const key = `contracts/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}-to-sign.pdf`
      const blob = await put(key, pdfBytes, {
        access: 'private' as any,
        contentType: 'application/pdf',
      })
      documentToSignUrl = blob.url
      finalizedPdf = 'rendered'
    } else {
      console.error('[contract-review/accept] props build failed:', built.error)
    }
  } catch (err) {
    console.error('[contract-review/accept] finalized render failed:', order.id, err)
  }

  await prisma.signedAgreement.update({
    where: { id: agreement.id },
    data: {
      status: 'NEGOTIATED_READY',
      documentType: 'NEGOTIATED',
      documentToSignUrl,
    },
  })

  // Who gets told. The order-level jobContact override wins; otherwise fall
  // back to the job's ranked contacts (PM -> PC -> primary -> first). Before
  // this fallback the route quietly emailed NOBODY whenever the order carried
  // no override — the agreement flipped to NEGOTIATED_READY and the client
  // never heard, which is the one failure mode this whole handoff exists to
  // avoid.
  const picked =
    order.jobContact?.email
      ? {
          id: order.jobContact.id,
          email: order.jobContact.email,
          name: [order.jobContact.firstName, order.jobContact.lastName].filter(Boolean).join(' '),
        }
      : pickCanonicalRecipient(order.job, order.jobContact)

  // The signing link. Legacy paperwork-portal token when the order has a
  // booking that carries one; otherwise the job portal's own magic link,
  // which is where the native flow signs. Only a job with neither leaves the
  // email linkless.
  let portalUrl: string | null = null
  let portalToken: string | null = null
  if (order.bookingId) {
    const paperwork = await prisma.paperworkRequest.findFirst({
      where: { bookingId: order.bookingId },
      orderBy: { sentAt: 'desc' },
      select: { token: true },
    })
    portalToken = paperwork?.token || null
    if (portalToken) portalUrl = portalTokenUrl(portalToken)
  }
  if (!portalUrl && order.portalSlug && picked?.id) {
    try {
      const link = await refreshOrIssueJobMagicLink({ orderId: order.id, contactId: picked.id })
      portalUrl = portalJobUrl(order.portalSlug, link.token)
    } catch (err) {
      console.error('[contract-review/accept] magic link failed:', order.id, err)
    }
  }

  const recipientEmail = picked?.email
  let emailResult: EmailResult | null = null
  let ccList: string[] = []
  if (recipientEmail) {
    // HQ is copied on the send (Wes 2026-09-04). This is the moment a
    // negotiated agreement becomes signable, and until now it left no
    // internal trace at all — the client was told, nobody here was. Read
    // from the channel registry rather than hardcoded, so who sees it is
    // changed at /admin/notifications and not in a deploy.
    // Everyone on the production, plus HQ. A negotiated agreement is the
    // document the whole client team works from — the quote already goes to
    // all of them, and sending the CONTRACT to one person means the
    // coordinator who has to act on it never sees it. Ranked list minus the
    // primary (who is on `to`), then the HQ channel.
    const others = rankRecipients(order.job, order.jobContact)
      .map((r) => r.email)
      .filter(Boolean)
    ccList = [...others, ...(await channelRecipients('hq-documents'))]
    const seen = new Set([recipientEmail.trim().toLowerCase()])
    ccList = ccList.filter((e) => {
      const norm = e.trim().toLowerCase()
      if (!norm || seen.has(norm)) return false
      seen.add(norm)
      return true
    })
    const firstName = (picked?.name || '').split(' ')[0] || 'there'
    const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#1a1a1a;padding:20px;text-align:center;">
      <div style="color:white;font-size:18px;font-weight:bold;">SirReel Studio Rentals</div>
      <div style="color:#bfd7ff;font-size:12px;margin-top:4px;">Negotiated agreement ready</div>
    </div>
    <div style="padding:20px;color:#374151;font-size:14px;line-height:1.5;">
      <p>Hi ${firstName},</p>
      <p>Thanks for your patience while we worked through the redline. The negotiated version of your rental agreement is ready to review and sign.</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 0;color:#6b7280;width:120px;">Company</td><td style="padding:4px 0;font-weight:600;">${order.company?.name || ''}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Job</td><td style="padding:4px 0;font-weight:600;">${order.job?.name || ''}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Order</td><td style="padding:4px 0;font-weight:600;">${order.orderNumber}</td></tr>
      </table>
      ${portalUrl
        ? `<div style="margin-top:20px;text-align:center;">
            <a href="${portalUrl}" style="display:inline-block;background:#1a1a1a;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Open the paperwork portal &rarr;</a>
          </div>`
        : `<p style="margin-top:16px;color:#6b7280;font-size:13px;">Your SirReel account rep will follow up with the signing link shortly.</p>`}
      <p style="margin-top:20px;color:#6b7280;font-size:12px;">If anything looks off, reply to this email and we&rsquo;ll loop the team back in.</p>
    </div>
    <div style="padding:14px 20px;background:#f9fafb;text-align:center;font-size:11px;color:#9ca3af;">
      SirReel Studio Services &middot; (888) 477-7335
    </div>
  </div>
</body></html>`
    emailResult = await sendAgreementEmail({
      label: 'orders/contract-review/accept',
      to: [recipientEmail],
      cc: ccList.length > 0 ? ccList : undefined,
      orderId: order.id,
      // The body says "reply to this email" — so a reply must reach the
      // agent's watched inbox, not the unmonitored notifications@ sender.
      replyTo: order.agent?.email ?? undefined,
      subject: `Your negotiated agreement is ready to sign · ${order.company?.name || order.orderNumber}`,
      html,
    })
  }

  return NextResponse.json({
    ok: true,
    status: 'NEGOTIATED_READY',
    documentToSignUrl,
    finalizedPdf,
    portalUrl,
    emailResult,
    recipientEmail: recipientEmail ?? null,
    cc: ccList,
  })
}
