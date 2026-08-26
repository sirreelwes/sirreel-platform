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
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  verifyJobSessionCookieValue,
  buildJobSessionCookieHeader,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { sendPaymentShareEmail } from '@/lib/payments/paymentShare'

export const dynamic = 'force-dynamic'

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

  // Everything past "is this request allowed" — the configured check, the
  // mint, and the message itself — is shared with the v2 paperwork portal's
  // share route so the two cannot send differently worded warnings.
  const result = await sendPaymentShareEmail({
    to,
    // Built from the host the client is actually on, not a configured origin:
    // the portal lives on its own host, and a link pointing at the marketing
    // site would 404 for the A/P department receiving it.
    origin: new URL(req.url).origin,
    company: resolved.order?.company?.name || 'your production',
    orderRef: resolved.order?.orderNumber ? ` for order ${resolved.order.orderNumber}` : '',
    createdVia: 'PORTAL',
    portalAccessId: session.portalAccessId,
    send: (msg) => sendAgreementEmail(msg),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ ok: true, sentTo: to })
}
