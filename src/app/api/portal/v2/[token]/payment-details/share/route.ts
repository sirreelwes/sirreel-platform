/**
 * POST /api/portal/v2/[token]/payment-details/share — email the payment
 * details to the client's accounts-payable team, from the guided portal.
 *
 * The producer authorizes the job; a separate A/P department pays it. Without
 * this, the producer reads the numbers here and retypes or forwards them,
 * putting account numbers back into email at the client's end — the exact hop
 * invoice-redirect fraud exploits, and the one SirReel cannot see.
 *
 * Same job as the job portal's share route, different door: this portal
 * authenticates by the PaperworkRequest token in the URL. Everything after
 * "is this request allowed" — the configured check, the mint, the message and
 * its anti-fraud warning — is the shared sendPaymentShareEmail, so the two
 * cannot drift into warning clients differently.
 *
 * RATE LIMIT. The job portal counts per PortalAccess session; there is no
 * such row here, so this counts per the BOOKING'S PERSON, which Booking
 * requires and every paperwork link therefore has. A producer legitimately
 * sends this once or twice. Unlimited, it is a way to make SirReel's mail
 * server deliver a link to any address on request — and a paperwork token
 * gets forwarded around, so the door is wider here than on the job portal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { sendPaymentShareEmail } from '@/lib/payments/paymentShare'

export const dynamic = 'force-dynamic'

/** Shares one client may create in a rolling day. */
const MAX_PER_PERSON_PER_DAY = 10

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const request = await prisma.paperworkRequest.findUnique({
    where: { token: params.token },
    select: {
      booking: {
        select: {
          personId: true,
          jobName: true,
          // Nullable: a call-in booking can exist before the production
          // company is known. The job name is the honest fallback — better in
          // an A/P inbox than "your production", which identifies nothing.
          company: { select: { name: true } },
          job: { select: { name: true, orders: { orderBy: { createdAt: 'desc' }, take: 1, select: { orderNumber: true } } } },
        },
      },
    },
  })
  if (!request?.booking) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
  }
  const booking = request.booking

  const body = (await req.json().catch(() => ({}))) as { email?: unknown }
  const to = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : ''
  if (!isEmail(to)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  const since = new Date(Date.now() - 86_400_000)
  const recent = await prisma.paymentDetailsShare.count({
    where: { personId: booking.personId, createdVia: 'PAPERWORK_PORTAL', createdAt: { gte: since } },
  })
  if (recent >= MAX_PER_PERSON_PER_DAY) {
    return NextResponse.json(
      { error: 'Too many sends today. Contact billing@sirreel.com and we will help.' },
      { status: 429 },
    )
  }

  const orderNumber = booking.job?.orders[0]?.orderNumber
  const result = await sendPaymentShareEmail({
    to,
    // The host the client is actually on — the portal has its own, and a link
    // to the marketing host would 404 for the A/P department receiving it.
    origin: new URL(req.url).origin,
    company:
      booking.company?.name ||
      resolveDisplayJobName({ jobName: booking.job?.name, bookingJobName: booking.jobName }) ||
      'your production',
    orderRef: orderNumber ? ` for order ${orderNumber}` : '',
    createdVia: 'PAPERWORK_PORTAL',
    personId: booking.personId,
    send: (msg) => sendAgreementEmail(msg),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ ok: true, sentTo: to })
}
