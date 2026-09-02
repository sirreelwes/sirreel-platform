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
import { ensureFreshQuotePdf } from '@/lib/orders/generateQuotePdf'
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
import { sendPortalInvite } from '@/lib/portal/sendPortalInvite'

export const dynamic = 'force-dynamic'

/** Ceiling on portal grants per send — see portalGrantTargets below. */
const MAX_PORTAL_GRANTS = 5
// Was 15. The send can now fan out to a portal invite per CC'd contact
// (each one a Person upsert + a Resend dispatch) on top of a possible
// PDF re-render — and a timeout here strands a quote that already went
// out. Same 30s ceiling most of the other send routes use.
export const maxDuration = 30

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
  /** Addresses among this email's CC list that the agent chose to put ON
   *  the portal (Wes 2026-09-02). Everyone CC'd sees the quote, but the
   *  portal button in it carries the PRIMARY contact's token — a producer
   *  who clicks it lands in the portal as someone else. Each address here
   *  gets its own PortalAccess + its own invite email instead.
   *
   *  Strictly a SUBSET of who this send actually copies: an address that
   *  isn't on the CC list is ignored, so this can never become a
   *  back-door "grant portal access to anyone" endpoint. */
  portalAccessFor?: unknown
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
  const portalAccessRequested = Array.isArray(body.portalAccessFor)
    ? (body.portalAccessFor.filter((v) => typeof v === 'string') as string[]).map((v) =>
        v.trim().toLowerCase(),
      )
    : []

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
  // A rep can rework an order all afternoon; nothing used to re-render the
  // stored PDF, so this route refused a stale one and told the rep to hit
  // Regenerate. Wes 2026-09-01: just re-cut it. Sending is the moment the
  // document has to be right, and a hard stop here is a wall between a rep
  // and the thing they asked to do.
  //
  // The refusal survives ONLY for the case the rewrite can't fix: the
  // re-render itself failed, so the blob on file is still the stale one and
  // sending it would put wrong prices in front of a client.
  // The blob key to attach. Replaced when the refresh below re-cuts the PDF:
  // regeneration DELETES the prior blob, so the key read above is dead.
  let quotePdfKey = order.quotePdfKey
  if (isQuotePdfStale(order)) {
    const refreshed = await ensureFreshQuotePdf(params.id)
    if (refreshed.key) quotePdfKey = refreshed.key
    if (!refreshed.regenerated) {
      return bad(
        400,
        `This order changed after the quote PDF was generated${
          order.quotePdfGeneratedAt ? ` (${order.quotePdfGeneratedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC)` : ''
        } and re-rendering it just failed${refreshed.error ? ` (${refreshed.error})` : ''}. Hit Regenerate on the order page before sending.`,
      )
    }
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
    const blob = await get(quotePdfKey, { access: 'private' })
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

  // Everyone this email copies who is a CLIENT — the auto job-contact CCs
  // plus whatever the rep typed. Computed once because it is also the
  // allow-list for the portal grants below: the team CC is added after
  // this line and must never be handed a client portal link.
  const clientCc = mergeCc(others.map((o) => o.email), manualCc, [primary.email]) ?? []

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
    cc: await withTeamCc(clientCc, primary.email),
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

  // ── Portal access for the people we CC'd ─────────────────
  //
  // Wes 2026-09-02: a quote that goes out to a producer with three people
  // copied should be able to put those people on the portal too. Until
  // now only the To: contact got a PortalAccess — the CC'd producer either
  // clicked the primary's token (and became them) or had to be invited by
  // hand from the order page afterwards.
  //
  // Grants are limited to `clientCc` — the addresses THIS email actually
  // copied. Anything else the request asked for is dropped silently rather
  // than 400'd: the email is already gone, and a rejected grant must not
  // read as a failed send.
  //
  // Each grant sends that person their own invite (their own link, their
  // own audit row). Per-address try/catch and non-fatal by design — the
  // quote is delivered; a portal invite that fails is a follow-up, not a
  // rolled-back send.
  // MAX_CC caps what the rep can TYPE; the auto job-contact CCs are on top
  // of that, so the grant fan-out gets its own ceiling. Beyond a handful
  // this is a mailing list, not a production team.
  const portalGrantTargets = portalAccessRequested
    .filter((addr) => clientCc.includes(addr))
    .slice(0, MAX_PORTAL_GRANTS)
  const portalGrants: { email: string; ok: boolean; error?: string }[] = []
  for (const addr of portalGrantTargets) {
    try {
      const invited = await sendPortalInvite({
        orderId: order.id,
        email: addr,
        // One row per (order, contact): re-sending a quote to the same CC
        // list refreshes their link instead of stacking duplicates.
        linkPolicy: 'refresh',
      })
      portalGrants.push({
        email: addr,
        ok: invited.emailResult.ok,
        error: invited.emailResult.ok ? undefined : invited.emailResult.reason,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'portal invite failed'
      console.error(`[send-quote] portal grant failed for ${addr}:`, msg)
      portalGrants.push({ email: addr, ok: false, error: msg })
    }
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
    portalGrants,
  })
}
