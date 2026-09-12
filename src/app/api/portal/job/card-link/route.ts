import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { ensureJobPaperworkBooking } from '@/lib/paperwork/ensurePaperworkBooking'
import { adoptJobPaperworkRequest } from '@/lib/paperwork/livePaperworkBooking'
import { portalV2Url } from '@/lib/portal/portalUrl'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { checkRateLimit } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/job/card-link — the client opening the card form for
 * themselves, before anyone sends them a card-authorization link.
 *
 * Oliver, testing the client side 2026-09-12: "why can't I upload my card? I
 * want to get ahead of the paperwork so I don't have to worry about it
 * later." The card form is the v2 paperwork page, keyed by a
 * PaperworkRequest token — and until now that row only existed once a rep
 * pressed "Send CC request", so the portal answered "your rep will send a
 * link when it is needed."
 *
 * ── Why this cannot just mint the row and be done ──────────────────────
 * `lib/payments/cardGate.ts` reads the existence of a PaperworkRequest as
 * "HQ asked for a card on this job", and from then on the yard and driver
 * check-outs refuse to release a truck until a card is on file. A client
 * clicking "add a card now" and then getting distracted would block their
 * own pickup. So the row is stamped `clientInitiatedAt`, and the gate
 * counts only rep-sent requests (Wes's ruling, 2026-09-12). The moment a
 * rep does send the CCA on this row, the stamp clears and it gates like
 * any other.
 *
 * An existing request is reused untouched — the client gets the same link
 * their rep already sent, never a second token (the rebook rule in
 * livePaperworkBooking.ts).
 */

/** Twenty an hour per seat: opening a form twice is normal, a script is not. */
const RATE = { windowMs: 60 * 60_000, max: 20 }

export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const rl = checkRateLimit(`portal-card-link:${session.portalAccessId}`, RATE)
  if (!rl.ok) {
    return NextResponse.json(
      { error: "That's a lot of attempts in a short time — try again in a while, or ask your rep." },
      { status: 429 },
    )
  }

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: {
      id: true,
      jobId: true,
      orderNumber: true,
      company: { select: { name: true } },
      job: { select: { id: true, name: true, jobCode: true } },
      jobContact: { select: { firstName: true, lastName: true, email: true } },
    },
  })
  if (!order?.jobId) {
    return NextResponse.json({ error: 'This order is not attached to a job yet.' }, { status: 400 })
  }

  // A job is enough to take a card (Wes 2026-09-05, the CCA is start
  // paperwork) — mint the booking the link hangs off when there is none.
  const ensured = await ensureJobPaperworkBooking(order.jobId)
  if (!ensured.ok) {
    return NextResponse.json(
      { error: 'We could not open the card form for this job. Your rep can send you the link.' },
      { status: 409 },
    )
  }

  const existing = await adoptJobPaperworkRequest(order.jobId, ensured.bookingId)
  let token = existing?.token ?? null
  let created = false
  if (!token) {
    const pr = await prisma.paperworkRequest.create({
      // sentTo stays empty: nobody sent this, the client opened it.
      data: { bookingId: ensured.bookingId, sentTo: '', clientInitiatedAt: new Date() },
      select: { token: true },
    })
    token = pr.token
    created = true
  }

  const who =
    [order.jobContact?.firstName, order.jobContact?.lastName].filter(Boolean).join(' ') ||
    order.jobContact?.email ||
    'The client'

  if (created) {
    await prisma.auditLog
      .create({
        data: {
          action: 'card_auth.client_started',
          entityType: 'Job',
          entityId: order.jobId,
          newValues: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            bookingId: ensured.bookingId,
            byPortalAccessId: session.portalAccessId,
            byName: who,
          },
        },
      })
      .catch(() => null)

    // The desk hears about it: a client putting a card down early is good
    // news, and it is also the only sign this row exists at all.
    const hq = await channelRecipients('portal-cards').catch(() => [] as string[])
    if (hq.length > 0) {
      const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
      const ctx = `${order.company?.name ?? 'A client'} — ${order.job?.name ?? ''} (${order.job?.jobCode ?? order.orderNumber})`
      const line = `${who} opened the card authorization form themselves from the job portal for ${ctx}. Nothing is on file yet, and this does NOT make the job card-required — it is their head start, not an HQ ask.`
      await sendAgreementEmail({
        to: hq,
        subject: `Client opened the card form — ${order.company?.name ?? order.orderNumber}`,
        html: `<p>${line}</p><p><a href="${base}/jobs/${order.jobId}">${base}/jobs/${order.jobId}</a></p>`,
        text: `${line}\n\n${base}/jobs/${order.jobId}`,
        label: 'portal-card-link-client-started',
      }).catch(() => null)
    }
  }

  return NextResponse.json({ ok: true, url: `${portalV2Url(token)}?open=cc` })
}
