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
import { get } from '@vercel/blob'
import { isQuotePdfStale } from '@/lib/orders/quotePdfFreshness'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { holdOnQuoteSend } from '@/lib/orders/holdOnQuoteSend'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { withTeamCc } from '@/lib/email/teamVisibility'
import { mergeCc, parseCcList } from '@/lib/email/ccList'
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
   *  send to primary only. NOTE: this can only NARROW to known job
   *  contacts — it filters `ranked`, it cannot introduce an address. */
  cc?: unknown
  /** Free-text CC typed by the rep in the review modal — ADDED to whoever
   *  is already being copied, never a replacement. Separate key from `cc`
   *  precisely because that one is a narrowing override. */
  ccAdd?: unknown
  /** Person.id picked by the agent in the EmailReviewModal's "Change
   *  recipient" affordance. Must be one of the order's ranked
   *  candidates or composer rejects with 400. */
  overrideContactId?: unknown
  /** "Write my own email" — the rep's prose REPLACES the templated opener
   *  and closer. Greeting, quote snapshot + portal CTA and sign-off stay. */
  customMessage?: unknown
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
  const manualCc = parseCcList(body.ccAdd)
  const ccOverride = Array.isArray(body.cc)
    ? (body.cc.filter((v) => typeof v === 'string') as string[])
    : null
  const overrideContactId =
    typeof body.overrideContactId === 'string' ? body.overrideContactId : null
  const customMessage =
    typeof body.customMessage === 'string' && body.customMessage.trim().length > 0
      ? body.customMessage.trim().slice(0, 5000)
      : null

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
    customMessage,
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
      quotePdfGeneratedAt: true,
      updatedAt: true,
      lineItems: { select: { updatedAt: true } },
      discounts: { select: { updatedAt: true } },
      portalSlug: true,
      agent: { select: { email: true } },
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
  // Nothing re-renders the stored PDF when the order changes, and this
  // route only ever checked that one EXISTED. A rep could rework an
  // order all afternoon and send the client that morning's prices. Refuse
  // rather than send a document that no longer matches the order — the
  // remedy is one click away on the same page.
  if (isQuotePdfStale(order)) {
    return bad(
      400,
      `This order changed after the quote PDF was generated${
        order.quotePdfGeneratedAt ? ` (${order.quotePdfGeneratedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC)` : ''
      }. Hit Regenerate so the client gets the current line items and totals.`,
    )
  }

  const primary = preliminary.to
  // CC list — same ranked-recipient pool the composer used. Optional
  // override; default is all non-primary contacts.
  const ranked = rankRecipients(order.job, order.jobContact)
  const others = ccOverride
    ? ranked.filter((r) => r.email !== primary.email && ccOverride.includes(r.email))
    : ranked.slice(1)

  // ── Attach the quote PDF ─────────────────────────────────────────
  //
  // It was unattached for a while, on the reasoning that a smaller email
  // delivers better and the portal button is one click away. In practice
  // that click is a real barrier: a producer scanning mail on a phone
  // wants to SEE the number, not authenticate into a portal first (Wes,
  // 2026-08-29). So it rides along again, and the portal CTA stays —
  // they're for different moments. The attachment is for reading now;
  // the portal is where they approve, sign and pay.
  //
  // Non-fatal by design: a blob that won't fetch must not block the
  // send. The client still gets the quote through the portal button,
  // which is exactly the state this email was in before.
  let quoteAttachment: { filename: string; content: Buffer }[] | undefined
  try {
    const blob = await get(order.quotePdfKey, { access: 'private' })
    if (blob && blob.statusCode === 200 && blob.stream) {
      const buf = Buffer.from(await new Response(blob.stream).arrayBuffer())
      quoteAttachment = [{ filename: `Quote-${order.orderNumber}.pdf`, content: buf }]
    } else {
      console.warn(`[send-quote] blob unavailable for ${order.orderNumber} — sending without the attachment`)
    }
  } catch (err) {
    console.warn('[send-quote] attachment fetch failed, sending without it:', err)
  }

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
    customMessage,
    overrideContactId,
    portalUrl,
    includeAttachmentMeta: false,
  })
  if (!final.ok) return bad(final.status, final.error)

  const emailResult = await sendAgreementEmail({
    to: [primary.email],
    // Replies route to the agent's watched inbox (the Gmail ingest
    // pipeline), not the unmonitored notifications@ sender — same as
    // thank-you and welcome sends.
    replyTo: order.agent?.email ?? undefined,
    // Auto-CC (the other job contacts) MERGED with the rep's typed CC —
    // a manual CC adds people, it never silently drops the contacts a
    // quote already copies.
    // ...then the shared desk. Wes 2026-08-28: the team should see a quote
    // went out, so a second person doesn't quote the same job. rentals@ is
    // right for CC and wrong for Reply-To — it's a Google Group, which is
    // exactly why HQ can't watch it and why a client's reply must never be
    // aimed at it (groups reject non-member mail). Reply-To stays the agent
    // + the hello@ ingest anchor.
    cc: await withTeamCc(mergeCc(others.map((o) => o.email), manualCc, [primary.email]) ?? [], primary.email),
    subject: final.subject,
    html: final.html,
    text: final.text,
    attachments: quoteAttachment,
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
    // A sent quote implies a hold (Wes 2026-08-25). Soft/backup rank, so
    // the fleet reads as spoken-for without a dead quote freezing a truck.
    // AFTER the email and deliberately non-fatal — the quote is already
    // delivered, so a hold failure must not report the send as failed.
    const holdResult = await holdOnQuoteSend(order.id)
    if (holdResult.error) {
      console.error('[send-quote] soft hold failed:', holdResult.error)
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
