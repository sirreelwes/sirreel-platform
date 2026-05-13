import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/orders/[id]/agreement/resend-link
 *
 * Sales tool: emails the paperwork-portal magic link for this order's booking
 * to the job's primary contact (or to an `email` override in the request body).
 * No new token is minted — we re-send the existing PaperworkRequest.token so
 * the client keeps the same URL.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { email?: unknown }
  const overrideEmail = typeof body.email === 'string' ? body.email.trim() : ''

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orderNumber: true,
      bookingId: true,
      company: { select: { name: true } },
      job: { select: { name: true, jobCode: true } },
      jobContact: { select: { email: true, firstName: true } },
    },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  if (!order.bookingId) {
    return NextResponse.json(
      { error: 'Order has no booking — portal link cannot be generated.' },
      { status: 409 },
    )
  }

  const paperwork = await prisma.paperworkRequest.findFirst({
    where: { bookingId: order.bookingId },
    orderBy: { sentAt: 'desc' },
    select: { token: true },
  })
  if (!paperwork) {
    return NextResponse.json(
      { error: 'No paperwork request exists for this booking yet.' },
      { status: 409 },
    )
  }

  const recipient = overrideEmail || order.jobContact?.email || ''
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return NextResponse.json(
      { error: 'No valid recipient email — pass `email` in the body to override.' },
      { status: 400 },
    )
  }

  const portalUrl = `https://hq.sirreel.com/portal/${paperwork.token}`

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({
      ok: true,
      portalUrl,
      recipient,
      emailed: false,
      note: 'RESEND_API_KEY not set — link not sent, but URL returned for manual copy.',
    })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const firstName = order.jobContact?.firstName || 'there'
  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#1f3d5c;padding:20px;text-align:center;">
      <div style="color:white;font-size:18px;font-weight:bold;">SirReel Studio Rentals</div>
      <div style="color:#bfd7ff;font-size:12px;margin-top:4px;">Paperwork portal link</div>
    </div>
    <div style="padding:20px;color:#374151;font-size:14px;line-height:1.5;">
      <p>Hi ${firstName},</p>
      <p>Here&rsquo;s your paperwork portal link for ${order.company?.name || ''}${order.job?.name ? ` &middot; ${order.job.name}` : ''}. Use it to sign the rental agreement, send a redline, or upload your COI.</p>
      <div style="margin:20px 0;text-align:center;">
        <a href="${portalUrl}" style="display:inline-block;background:#1f3d5c;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Open paperwork portal &rarr;</a>
      </div>
      <p style="color:#6b7280;font-size:12px;">Or paste this URL into your browser: ${portalUrl}</p>
    </div>
    <div style="padding:14px 20px;background:#f9fafb;text-align:center;font-size:11px;color:#9ca3af;">
      SirReel Studio Services &middot; (888) 477-7335
    </div>
  </div>
</body></html>`

  try {
    await resend.emails.send({
      from: 'SirReel HQ <notifications@sirreel.com>',
      to: [recipient],
      subject: `Paperwork portal link · ${order.company?.name || order.orderNumber}`,
      html,
    })
  } catch (err) {
    console.error('[orders/agreement/resend-link] email failed:', err)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, portalUrl, recipient, emailed: true })
}
