/**
 * Re-send the quote when something other than the rep changed it.
 *
 * Wes, 2026-09-03: "yes, re-send the quote automatically when the
 * check-out changes it but copy hq notifications."
 * Wes, 2026-09-05, after Subplot elected LCDW in the portal and nothing
 * told them the number moved: make sure the updated quote is flagged to
 * the client.
 *
 * Two callers, one sender:
 *
 *  · 'check-out' — the yard's check-out report wrote what actually went
 *    out onto the order's lines. At SirReel the document on the truck is
 *    routinely still a QUOTE — the status catches up days after the gear
 *    is back — so a supervisor typing in a swap can silently leave the
 *    client holding a quote that no longer matches the order.
 *  · 'lcdw-election' — the client accepted (or declined) the damage
 *    waiver in the portal and the fee line was applied for them. They
 *    made the change themselves, so this is a confirmation with the new
 *    number on it, not a surprise.
 *
 * In both cases the action item tells the AGENT; this tells the CLIENT,
 * which is the half that was missing.
 *
 * ── What it deliberately will NOT do ──────────────────────────────
 *
 *  · It never sends a quote the client has not already seen. A DRAFT
 *    with no quoteSentAt has no "re-" to send: mailing one would turn a
 *    supervisor's count sheet into the first thing a client ever hears
 *    from us about a job.
 *  · It stops once the order is BOOKED. Past that the client's document
 *    is an order and an agreement, not a quote, and re-sending a quote
 *    against a signed job would be confusing at best.
 *  · It never re-stamps quoteSentAt. This is a correction, not a new
 *    quote, and the aging/cadence surfaces read that timestamp.
 *  · It never blocks the caller. Every failure path returns a reason and
 *    the report still files / the election still records — neither the
 *    yard's work nor the client's answer may depend on Resend.
 *
 * Relationship to POST /api/orders/[id]/send-quote: that route is the
 * rep-driven send, with CC overrides, a typed message, portal grants for
 * copied contacts and the status flip. This is the automatic one, and it
 * is deliberately lean — same composer, same PDF freshness rule, same
 * team CC, plus HQ notifications. If the composer or the freshness rule
 * changes, both move together because both call the same helpers.
 */

import { get } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { composeQuoteEmail } from '@/lib/email/preview/composeQuoteEmail'
import { ensureFreshQuotePdf } from '@/lib/orders/generateQuotePdf'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { withTeamCc } from '@/lib/email/teamVisibility'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { mergeCc } from '@/lib/email/ccList'
import { rankRecipients } from '@/lib/email/recipients'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { portalJobUrl } from '@/lib/portal/portalUrl'

/** Statuses where the client's live document is still a quote. */
const QUOTE_STAGE_STATUSES = new Set(['DRAFT', 'QUOTE_SENT', 'APPROVED'])

export type ResendOutcome =
  | { sent: true; to: string; cc: string[] }
  | { sent: false; reason: string }

export type QuoteChangeReason = 'check-out' | 'lcdw-election'

const INTRO: Record<QuoteChangeReason, string> = {
  'check-out': 'Your order changed at load-out, so here is the updated quote.',
  'lcdw-election':
    'Thanks for confirming your Limited Collision Damage Waiver election — ' +
    'here is your updated quote with it applied.',
}

const CLOSING: Record<QuoteChangeReason, string> = {
  'check-out':
    'The attached PDF and the portal both reflect what actually went out. ' +
    'If anything here looks wrong, reply to this email and we will sort it out.',
  'lcdw-election':
    'The attached PDF and the portal both reflect the updated total. ' +
    'If anything here looks wrong, reply to this email and we will sort it out.',
}

const AUDIT_ACTION: Record<QuoteChangeReason, string> = {
  'check-out': 'order.quote_resent_after_check_out',
  'lcdw-election': 'order.quote_resent_after_lcdw_election',
}

/**
 * The BODY of the email — not a note beside the standard one. It has to
 * answer the question a client will actually have — "why am I getting
 * this again?" — in the first sentence, and it names the changes rather
 * than making them hunt through the PDF for the difference.
 *
 * Wes, 2026-09-05, after Luis at Subplot got the LCDW confirmation: "the
 * email to Luis sent a 'we'd love to work with you again' text rather
 * than 'your quote was updated'. Stop adding that welcome message to
 * future emails." This used to go in as `message` (the italic side note),
 * which left the composer's standard opener — "It's great to hear from
 * you — we'd love to work with you on this one" — as the first thing the
 * client read on a quote they already had. It now goes in as
 * `customMessage`, which REPLACES the opener; the greeting, the quote
 * block with the new total, the portal button and the sign-off stay.
 */
function changeNote(reason: QuoteChangeReason, changes: string[], firstName: string | null): string {
  const list = changes.slice(0, 8).join('\n• ')
  const more = changes.length > 8 ? `\n• …and ${changes.length - 8} more` : ''
  // A supplied body is the WHOLE email as far as the composer is concerned
  // — it stands its own greeting down (the rep's box is assumed to carry
  // one) — so the greeting has to be here.
  const greeting = firstName ? `Hi ${firstName},\n\n` : 'Hi there,\n\n'
  return `${greeting}${INTRO[reason]}\n\n• ${list}${more}\n\n${CLOSING[reason]}`
}

/** First name off a ranked recipient's display name, or null. */
function firstNameOf(name: string | null | undefined): string | null {
  const token = name?.trim().split(/\s+/)[0] ?? ''
  return token && !token.includes('@') ? token : null
}

/** The check-out report's entry point — unchanged signature. */
export function resendQuoteAfterCheckOut(opts: {
  orderId: string
  changes: string[]
}): Promise<ResendOutcome> {
  return resendQuoteOnChange({ ...opts, reason: 'check-out' })
}

export async function resendQuoteOnChange(opts: {
  orderId: string
  changes: string[]
  reason: QuoteChangeReason
}): Promise<ResendOutcome> {
  const { orderId, changes, reason } = opts
  if (changes.length === 0) return { sent: false, reason: 'nothing changed' }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      quoteSentAt: true,
      quotePdfKey: true,
      quotePdfUrl: true,
      quotePdfGeneratedAt: true,
      updatedAt: true,
      portalSlug: true,
      lineItems: { select: { updatedAt: true } },
      discounts: { select: { updatedAt: true } },
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
  if (!order) return { sent: false, reason: 'order not found' }
  if (!QUOTE_STAGE_STATUSES.has(order.status)) {
    return { sent: false, reason: `order is ${order.status.toLowerCase()} — the client's document is no longer a quote` }
  }
  if (!order.quoteSentAt) {
    return { sent: false, reason: 'this quote has never been sent to the client' }
  }

  // The order's lines just moved, so the stored PDF is wrong by
  // construction — always re-cut, never fall back to the stale one. That
  // is the difference from the rep-driven route, which sends what is on
  // file when a re-render fails: here the whole point is that the
  // document changed, so a stale attachment would defeat the send.
  const refreshed = await ensureFreshQuotePdf(orderId)
  const pdfKey = refreshed.key ?? order.quotePdfKey
  if (!pdfKey) {
    return { sent: false, reason: 'no quote PDF could be produced' }
  }

  // Compose once without a portal URL to learn the canonical recipient,
  // then again with the token bound to them — the same two-phase dance
  // the send route does, and for the same reason.
  const preliminary = await composeQuoteEmail({
    orderId,
    message: null,
    customMessage: changeNote(reason, changes, null),
    overrideContactId: null,
    portalUrl: null,
    includeAttachmentMeta: false,
  })
  if (!preliminary.ok) return { sent: false, reason: preliminary.error }
  const primary = preliminary.to

  let portalUrl: string | null = null
  if (order.portalSlug) {
    try {
      const link = await refreshOrIssueJobMagicLink({ orderId: order.id, contactId: primary.id })
      portalUrl = portalJobUrl(order.portalSlug, link.token)
    } catch (err) {
      console.warn('[resend-quote] portal-link mint failed:', err)
    }
  }

  const final = await composeQuoteEmail({
    orderId,
    message: null,
    customMessage: changeNote(reason, changes, firstNameOf(primary.name)),
    overrideContactId: null,
    portalUrl,
    includeAttachmentMeta: false,
  })
  if (!final.ok) return { sent: false, reason: final.error }

  // Attachment is best-effort, exactly as on the rep-driven send: a blob
  // that will not fetch must not stop the client hearing about a change.
  let attachments: { filename: string; content: Buffer }[] | undefined
  try {
    const blob = await get(pdfKey, { access: 'private' })
    if (blob && blob.statusCode === 200 && blob.stream) {
      const buf = Buffer.from(await new Response(blob.stream).arrayBuffer())
      attachments = [{ filename: `Quote-${order.orderNumber}.pdf`, content: buf }]
    }
  } catch (err) {
    console.warn('[resend-quote] attachment fetch failed, sending without it:', err)
  }

  // CC: the job's other contacts, the sales desk, and — Wes's ask — HQ
  // notifications, because a quote that changed itself at the dock is
  // something the office should see go out, not something it discovers
  // from a client. channelRecipients so the audience stays editable at
  // /admin/notifications rather than hardcoded here.
  const ranked = rankRecipients(order.job, order.jobContact)
  const otherContacts = ranked.slice(1).map((r) => r.email)
  const hq = await channelRecipients('hq-documents')
  const clientCc = mergeCc(otherContacts, undefined, [primary.email]) ?? []
  const cc = await withTeamCc(mergeCc(clientCc, hq, [primary.email]) ?? [], primary.email)

  const emailResult = await sendAgreementEmail({
    to: [primary.email],
    // Replies go to the agent, never to notifications@ — same rule every
    // other client-facing send follows.
    replyTo: order.agent?.email ?? undefined,
    cc,
    subject: `Updated quote — ${final.subject.replace(/^Quote[:\s-]*/i, '')}`.trim(),
    html: final.html,
    text: final.text,
    attachments,
    label: `resend-quote-on-change:${reason}:${order.orderNumber}`,
  })
  if (!emailResult.ok) return { sent: false, reason: emailResult.reason }

  if (emailResult.id) {
    await recordEmailDelivery({
      resendMessageId: emailResult.id,
      toAddress: primary.email,
      ccAddresses: cc,
      subject: final.subject,
      label: `resend-quote-on-change:${reason}:${order.orderNumber}`,
      orderId: order.id,
    })
  }

  // Audited as its own action: nobody clicked send, so "who sent this"
  // has to be answerable from the log.
  await prisma.auditLog.create({
    data: {
      userId: null,
      action: AUDIT_ACTION[reason],
      entityType: 'Order',
      entityId: order.id,
      oldValues: {},
      newValues: { to: primary.email, cc, changes, reason, at: new Date().toISOString() },
    },
  })

  return { sent: true, to: primary.email, cc }
}
