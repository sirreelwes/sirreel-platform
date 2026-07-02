/**
 * POST /api/orders/[id]/send-quote
 *
 * Closes the lifecycle-audit gap where the "Send Quote" button only
 * flipped Order.status → QUOTE_SENT and never actually emailed the
 * client. This route:
 *
 *   1. Composes the email via the shared composeQuoteEmail helper
 *      (recipient ranking, PDF metadata, body render). Same helper
 *      backs the /preview endpoint — no drift between what the agent
 *      reviews and what actually sends.
 *   2. Fetches the previously-generated Quote PDF buffer from Vercel
 *      Blob. Refuses to send when no PDF exists (agent must generate
 *      via the existing "Regenerate PDF" button first).
 *   3. Mints/refreshes the portal magic-link, re-runs the composer
 *      with the tokenized URL, and dispatches via sendAgreementEmail
 *      (Resend). Optional CC to the other JobContacts and an optional
 *      custom note in the body.
 *   4. On email-send success, flips the order to QUOTE_SENT if it
 *      was DRAFT.
 *
 * Resends (status already QUOTE_SENT or beyond): email goes out
 * fresh; we do NOT re-flip status or re-stamp quoteSentAt — the
 * original send timestamp stays.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { composeQuoteEmail } from '@/lib/email/preview/composeQuoteEmail'
import { computeQuoteStatusSync } from '@/lib/orders/quoteStatus'
import { snapshotResolvedRates } from '@/lib/pricing/resolveRate'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { rankRecipients } from '@/lib/email/recipients'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { portalJobUrl } from '@/lib/portal/portalUrl'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

interface SendQuoteBody {
  /** Optional plain-text message inserted into the email body above the
   *  standard quote-attached line. */
  message?: unknown
  /** Optional override of CC recipients. When omitted, all non-primary
   *  JobContacts on the order's job are CC'd. Pass an empty array to
   *  send to primary only. */
  cc?: unknown
  /** Person.id picked by the agent in the EmailReviewModal's "Change
   *  recipient" affordance. Must be one of the order's ranked
   *  candidates or composer rejects with 400. */
  overrideContactId?: unknown
}

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const body = (await req.json().catch(() => ({}))) as SendQuoteBody
  const message =
    typeof body.message === 'string' && body.message.trim().length > 0
      ? body.message.trim().slice(0, 5000)
      : null
  const ccOverride = Array.isArray(body.cc)
    ? (body.cc.filter((v) => typeof v === 'string') as string[])
    : null
  const overrideContactId =
    typeof body.overrideContactId === 'string' ? body.overrideContactId : null

  // ── Mint/refresh portal token, then compose with tokenized URL ─
  // Two phases: (1) preview-compose with portalUrl=null to learn the
  // canonical recipient + validate the order; (2) mint token bound to
  // that recipient; (3) compose-again with the tokenized URL. Could
  // be one call if we resolved the recipient inline here, but routing
  // both phases through the shared composer is the whole point —
  // single source of truth.
  const preliminary = await composeQuoteEmail({
    orderId: params.id,
    message,
    overrideContactId,
    portalUrl: null,
    // Send route fetches the buffer separately; preview metadata not needed.
    includeAttachmentMeta: false,
  })
  if (!preliminary.ok) return bad(preliminary.status, preliminary.error)

  // Load Order separately for portalSlug + state-write fields the
  // composer doesn't surface. Keeps the composer focused on email
  // shape; the send route owns the lifecycle columns.
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      quoteSentAt: true,
      sentAt: true,
      wonAt: true,
      lostAt: true,
      quotePdfKey: true,
      quotePdfUrl: true,
      portalSlug: true,
      job: {
        select: {
          jobContacts: {
            select: {
              role: true,
              isPrimary: true,
              person: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
        },
      },
      jobContact: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })
  if (!order) return bad(404, 'order not found')
  if (!order.quotePdfKey || !order.quotePdfUrl) {
    return bad(400, 'No quote PDF — regenerate from the order detail page first.')
  }

  const primary = preliminary.to
  // CC list — same ranked-recipient pool the composer used. Optional
  // override; default is all non-primary contacts.
  const ranked = rankRecipients(order.job, order.jobContact)
  const others = ccOverride
    ? ranked.filter((r) => r.email !== primary.email && ccOverride.includes(r.email))
    : ranked.slice(1)

  // Quote PDF is no longer attached — the TSX welcome template's
  // primary CTA links to the portal job page where "Download quote
  // PDF" is one click away. Smaller email = better deliverability
  // and a less intimidating first touch from a new sales contact.
  // The blob still exists; the portal page proxies it through the
  // auth-gated /api/portal/job/{slug}/quote-pdf route (or wherever
  // the portal page links it).

  // ── Refresh or mint the portal magic-link token ──────────
  // One PortalAccess row per (orderId, contactId) — refresh expiresAt
  // on every send so the embedded link stays live. See helper.
  let portalUrl: string | null = null
  if (order.portalSlug) {
    try {
      const link = await refreshOrIssueJobMagicLink({ orderId: order.id, contactId: primary.id })
      portalUrl = portalJobUrl(order.portalSlug, link.token)
    } catch (err) {
      console.warn('[send-quote] portal-link mint failed:', err)
    }
  }

  // ── Compose the final email with tokenized URL ───────────
  const final = await composeQuoteEmail({
    orderId: params.id,
    message,
    overrideContactId,
    portalUrl,
    includeAttachmentMeta: false,
  })
  if (!final.ok) return bad(final.status, final.error)

  const emailResult = await sendAgreementEmail({
    to: [primary.email],
    cc: others.length > 0 ? others.map((o) => o.email) : undefined,
    subject: final.subject,
    html: final.html,
    text: final.text,
    label: `send-quote:${order.orderNumber}`,
  })

  if (!emailResult.ok) {
    return NextResponse.json(
      { ok: false, error: `Email send failed: ${emailResult.reason}`, emailResult },
      { status: 502 },
    )
  }

  // Audit the delivery so the order detail page can show
  // sent/delivered/bounced as Resend's webhook events arrive. Best-
  // effort; a failure here doesn't undo the send.
  if (emailResult.id) {
    await recordEmailDelivery({
      resendMessageId: emailResult.id,
      toAddress: primary.email,
      ccAddresses: others.map((o) => o.email),
      subject: final.subject,
      label: `send-quote:${order.orderNumber}`,
      orderId: order.id,
    })
  }

  // ── State transition (DRAFT → QUOTE_SENT) ────────────────
  if (order.status === 'DRAFT') {
    // Sprint 1 — quote-time rate snapshot: stamp resolvedRate on any line
    // still missing one so post-quote Fleet Pricing edits can't rewrite
    // what the client saw. Non-fatal — the email already went out.
    try {
      await snapshotResolvedRates(order.id)
    } catch (err) {
      console.error('[pricing] quote-time rate snapshot failed:', err instanceof Error ? err.message : err)
    }
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'QUOTE_SENT',
        quoteSentAt: order.quoteSentAt ?? new Date(),
        ...computeQuoteStatusSync('QUOTE_SENT', {
          sentAt: order.sentAt,
          wonAt: order.wonAt,
          lostAt: order.lostAt,
        }),
      },
    })
  }

  return NextResponse.json({
    ok: true,
    emailId: emailResult.id,
    recipient: { email: primary.email, name: primary.name },
    cc: others.map((o) => ({ email: o.email, name: o.name })),
  })
}
