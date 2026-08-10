/**
 * POST /api/portal/job/payment-details/share — email a scoped link to the
 * client's accounts-payable team.
 *
 * The producer authorizes the job; a separate A/P department pays it. Without
 * this, the producer reads the details in the portal and retypes or forwards
 * them, putting the account numbers back into email at the client's end —
 * which is the hop invoice-redirect fraud actually exploits, and the hop
 * SirReel has no visibility into.
 *
 * The email carries NO account numbers. It carries a link. There is nothing
 * in the message for an attacker to rewrite, and the recipient reads the
 * details from sirreel.com over TLS.
 *
 * Rate-limited per portal session: a producer legitimately sends this once or
 * twice, and the endpoint is otherwise a way to have SirReel's mail server
 * deliver arbitrary addresses a link on request.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  verifyJobSessionCookieValue,
  buildJobSessionCookieHeader,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

export const dynamic = 'force-dynamic'

/** Long enough that guessing is hopeless — the URL is the credential. */
const TOKEN_BYTES = 24
const TTL_DAYS = 90
/** Shares one session may create in a rolling day. */
const MAX_PER_SESSION_PER_DAY = 10

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const body = (await req.json().catch(() => ({}))) as { email?: unknown }
  const to = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : ''
  if (!isEmail(to)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  const since = new Date(Date.now() - 86_400_000)
  const recent = await prisma.paymentDetailsShare.count({
    where: { portalAccessId: session.portalAccessId, createdAt: { gte: since } },
  })
  if (recent >= MAX_PER_SESSION_PER_DAY) {
    return NextResponse.json(
      { error: 'Too many sends today. Contact billing@sirreel.com and we will help.' },
      { status: 429 },
    )
  }

  // Confirm details EXIST before promising an A/P department a working link.
  // Sending someone to an empty page invites them to go hunting for the
  // numbers in an old email, which is the habit this is meant to break.
  const s = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { paymentPayeeName: true, paymentAccountNumber: true, paymentRoutingAch: true },
  })
  if (!s?.paymentPayeeName || !s?.paymentAccountNumber || !s?.paymentRoutingAch) {
    console.error('[payment-share] details not configured — nothing sent')
    return NextResponse.json(
      { error: 'Payment details are not available yet. Contact billing@sirreel.com.' },
      { status: 409 },
    )
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000)
  await prisma.paymentDetailsShare.create({
    data: { token, portalAccessId: session.portalAccessId, sentToEmail: to, expiresAt },
  })

  // Built from the host the client is actually on, not a configured origin:
  // the portal lives on its own host, and a link pointing at the marketing
  // site would 404 for the A/P department receiving it.
  const link = `${new URL(req.url).origin}/pay-details/${token}`
  const orderRef = resolved.order?.orderNumber ? ` for order ${resolved.order.orderNumber}` : ''
  const company = resolved.order?.company?.name || 'your production'

  const text = [
    'Hello,',
    '',
    `${company} has asked us to send SirReel Studio Services' payment details${orderRef}.`,
    '',
    'You can view them here:',
    link,
    '',
    'We do not send banking details by email, and our details never change.',
    'If you receive a message claiming our bank account has changed — even from',
    'a familiar address — call us before sending payment.',
    '',
    'Questions: billing@sirreel.com',
    '',
    'SirReel Studio Services',
  ].join('\n')

  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;color:#1a1a1a">
      <p>Hello,</p>
      <p>${escapeHtml(company)} has asked us to send SirReel Studio Services&rsquo; payment
      details${escapeHtml(orderRef)}.</p>
      <p style="margin:22px 0">
        <a href="${link}" style="background:#1a1a1a;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View payment details</a>
      </p>
      <p style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:11px 13px;font-size:13px;color:#78350f">
        <strong>We do not send banking details by email, and our details never change.</strong>
        If you receive a message claiming our bank account has changed &mdash; even from a
        familiar address &mdash; call us before sending payment.
      </p>
      <p style="font-size:13px;color:#555">Questions: billing@sirreel.com</p>
      <p style="font-size:13px;color:#555">SirReel Studio Services</p>
    </div>`

  const sent = await sendAgreementEmail({
    to: [to],
    subject: `SirReel Studio Services — payment details${orderRef}`,
    html,
    text,
  })
  if (!sent.ok) {
    console.error('[payment-share] send failed to %s: %s', to, sent.reason)
    return NextResponse.json(
      { error: 'We could not send that email. Contact billing@sirreel.com.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, sentTo: to })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
