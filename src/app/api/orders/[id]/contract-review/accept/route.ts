import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'

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
      company: { select: { name: true } },
      job: { select: { name: true, jobCode: true } },
      jobContact: { select: { email: true, firstName: true, lastName: true } },
      signedAgreement: {
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
  const agreement = order.signedAgreement
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

  await prisma.signedAgreement.update({
    where: { id: agreement.id },
    data: {
      status: 'NEGOTIATED_READY',
      documentType: 'NEGOTIATED',
      documentToSignUrl: agreement.contractReview.counterPdfUrl,
    },
  })

  // Look up the paperwork portal magic link for this order's booking so we can
  // include it in the client email. Orders without a booking won't get a link;
  // the email body falls back to a generic note in that case.
  let portalToken: string | null = null
  if (order.bookingId) {
    const paperwork = await prisma.paperworkRequest.findFirst({
      where: { bookingId: order.bookingId },
      orderBy: { sentAt: 'desc' },
      select: { token: true },
    })
    portalToken = paperwork?.token || null
  }

  const recipientEmail = order.jobContact?.email
  if (recipientEmail && process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const portalUrl = portalToken ? `https://hq.sirreel.com/portal/${portalToken}` : null
    const firstName = order.jobContact?.firstName || 'there'
    const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#1f3d5c;padding:20px;text-align:center;">
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
            <a href="${portalUrl}" style="display:inline-block;background:#1f3d5c;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Open the paperwork portal &rarr;</a>
          </div>`
        : `<p style="margin-top:16px;color:#6b7280;font-size:13px;">Your SirReel account rep will follow up with the signing link shortly.</p>`}
      <p style="margin-top:20px;color:#6b7280;font-size:12px;">If anything looks off, reply to this email and we&rsquo;ll loop the team back in.</p>
    </div>
    <div style="padding:14px 20px;background:#f9fafb;text-align:center;font-size:11px;color:#9ca3af;">
      SirReel Studio Services &middot; (888) 477-7335
    </div>
  </div>
</body></html>`
    try {
      await resend.emails.send({
        from: 'SirReel HQ <notifications@sirreel.com>',
        to: [recipientEmail],
        subject: `Your negotiated agreement is ready to sign · ${order.company?.name || order.orderNumber}`,
        html,
      })
    } catch (err) {
      console.error('[orders/contract-review/accept] client email failed:', err)
    }
  }

  return NextResponse.json({
    ok: true,
    status: 'NEGOTIATED_READY',
    documentToSignUrl: agreement.contractReview.counterPdfUrl,
    portalUrl: portalToken ? `https://hq.sirreel.com/portal/${portalToken}` : null,
    recipientEmailed: !!(recipientEmail && process.env.RESEND_API_KEY),
  })
}
