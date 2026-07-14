/**
 * Reply-detection for sales inquiries — shared by the Gmail ingest
 * paths and the Quick Reply send route so both converge on the same
 * mechanism.
 *
 * When a staff-authored message lands on an email thread, every open
 * (status=NEW, not-yet-responded) Inquiry whose originating email
 * lives on that thread gets stamped respondedAt/respondedBy. First
 * staff reply wins; later staff messages are no-ops. Status is NOT
 * touched — a responded inquiry is still an open lead awaiting
 * capture/convert; the Pipeline separates on respondedAt.
 *
 * Authorship gate mirrors the claims onboarding bridge
 * (src/lib/claims/shouldOnboardClaimEmail.ts): gate on the From:
 * AUTHOR, not the computed direction, with a self-exclusion for the
 * platform's own automated sender (notifications@ — Resend system
 * sends like cadence emails are not a human reply).
 *
 * Inquiry ↔ thread matching rule: Inquiry has no thread FK. A GMAIL
 * inquiry records its originating email as sourceMetadata.emailMessageId
 * plus rfc822MessageId. We collect the thread's messages and match
 * inquiries on EITHER key — rfc822MessageId catches cross-inbox copies
 * of the originating message, emailMessageId catches rows that predate
 * rfc822 stamping.
 */

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { parseEmailAddress } from '@/lib/email/direction'

/** Automated platform sender (Resend SEND_FROM) — never a human reply. */
const SYSTEM_SENDER = 'notifications@sirreel.com'

/**
 * Is this From: header a SirReel staff member (a human whose reply
 * should mark linked inquiries responded)? Accepts raw headers
 * ('Jose Pacheco <jose@sirreel.com>') or bare addresses.
 */
export function isStaffReplyAuthor(fromHeader: string): boolean {
  const addr = parseEmailAddress(fromHeader)
  if (!addr || !addr.endsWith('@sirreel.com')) return false
  return addr !== SYSTEM_SENDER
}

export interface MarkRespondedInput {
  /**
   * EmailThread.id and/or the Gmail thread id. Both are queried against
   * EmailMessage.threadId because the ingest paths disagree on what they
   * store there (pubsub writes EmailThread.id; the legacy history-fetch
   * path wrote the raw Gmail thread id).
   */
  threadKeys: string[]
  /** Bare staff address for attribution (already validated by caller). */
  staffEmail: string
  /** When the reply was sent. */
  at: Date
}

/**
 * Stamp respondedAt/respondedBy on every open, not-yet-responded
 * Inquiry linked to this thread. Returns the ids of inquiries updated.
 * Never throws — ingest/send callers treat this as best-effort.
 */
export async function markInquiriesRespondedForThread(
  input: MarkRespondedInput,
): Promise<string[]> {
  try {
    const threadKeys = input.threadKeys.filter(Boolean)
    if (threadKeys.length === 0) return []

    const threadMessages = await prisma.emailMessage.findMany({
      where: { threadId: { in: threadKeys } },
      select: { id: true, rfc822MessageId: true },
    })
    if (threadMessages.length === 0) return []

    const messageIds = new Set(threadMessages.map((m) => m.id))
    const rfcIds = new Set(
      threadMessages.map((m) => m.rfc822MessageId).filter((v): v is string => !!v),
    )

    // Open = NEW and not yet responded. Bounded set; sourceMetadata is
    // JSON so we match emailMessageId in JS (same pattern as the
    // suggested-inquiries route).
    const openInquiries = await prisma.inquiry.findMany({
      where: { status: 'NEW', respondedAt: null },
      select: { id: true, rfc822MessageId: true, sourceMetadata: true },
    })

    const matched = openInquiries.filter((i) => {
      if (i.rfc822MessageId && rfcIds.has(i.rfc822MessageId)) return true
      const meta = i.sourceMetadata as Record<string, unknown> | null
      const emailId = meta?.emailMessageId
      return typeof emailId === 'string' && messageIds.has(emailId)
    })
    if (matched.length === 0) return []

    const ids = matched.map((i) => i.id)
    // respondedAt: null in the WHERE keeps this first-reply-wins even if
    // two ingest paths race — the second updateMany matches zero rows.
    await prisma.inquiry.updateMany({
      where: { id: { in: ids }, respondedAt: null },
      data: {
        respondedAt: input.at,
        respondedBy: parseEmailAddress(input.staffEmail),
      },
    })
    return ids
  } catch (err) {
    console.warn(
      '[markInquiryResponded] failed (non-blocking):',
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

/**
 * Ingest-side entry point: applies the staff-authorship gate, then
 * marks. Called by the Gmail ingest paths for every persisted message;
 * returns [] fast for client-authored mail.
 */
export async function handleIngestedMessageForInquiryReply(input: {
  threadKeys: string[]
  fromAddress: string
  sentAt: Date
}): Promise<string[]> {
  if (!isStaffReplyAuthor(input.fromAddress)) return []
  return markInquiriesRespondedForThread({
    threadKeys: input.threadKeys,
    staffEmail: input.fromAddress,
    at: input.sentAt,
  })
}

/**
 * Quick Reply convergence. Quick Replies go out via Resend (from
 * notifications@), never touch Gmail, and so are invisible to the
 * ingest paths. This records the sent reply as an outbound
 * EmailMessage on the SAME thread as the inbound being replied to —
 * thread-matched only, never wholesale — so the inquiry's thread view
 * shows the reply, updates the thread's direction state (which also
 * drops the thread from the suggested-inquiries stream), and marks
 * linked inquiries responded attributed to the sending agent.
 *
 * Best-effort: the email already went out; failures log and return null.
 */
export async function recordQuickReplyOnThread(input: {
  /** EmailMessage.id of the inbound being replied to. */
  inboundEmailMessageId: string
  /** Logged-in agent's address — attribution + synthetic From:. */
  staffEmail: string
  recipientEmail: string
  subject: string
  bodyText: string | null
  bodyHtml: string | null
}): Promise<{ emailMessageId: string; respondedInquiryIds: string[] } | null> {
  try {
    const now = new Date()
    const inbound = await prisma.emailMessage.findUnique({
      where: { id: input.inboundEmailMessageId },
      select: {
        id: true,
        threadId: true,
        emailAccountId: true,
        subject: true,
        sentAt: true,
        gmailMessageId: true,
      },
    })
    if (!inbound) return null

    // Inbounds without a thread row (pre-thread-tracking ingests) used to
    // short-circuit here — the reply went out but NOTHING was recorded, so
    // the card lingered looking untouched and a second agent could
    // double-reply. Mint the thread now instead. Upserting on the
    // inbound's gmailMessageId converges with a later real Gmail sync of
    // the same thread (Gmail thread ids equal the first message's id)
    // rather than duplicating it.
    let threadId = inbound.threadId
    if (!threadId) {
      const minted = await prisma.emailThread.upsert({
        where: { gmailThreadId: inbound.gmailMessageId },
        create: {
          gmailThreadId: inbound.gmailMessageId,
          subject: inbound.subject,
          lastMessageAt: inbound.sentAt,
          messageCount: 1,
          lastInboundAt: inbound.sentAt,
          lastDirection: 'INBOUND',
        },
        update: {},
        select: { id: true },
      })
      await prisma.emailMessage.update({
        where: { id: inbound.id },
        data: { threadId: minted.id },
      })
      threadId = minted.id
    }

    const created = await prisma.emailMessage.create({
      data: {
        emailAccountId: inbound.emailAccountId,
        threadId,
        // Synthetic id — Quick Replies have no Gmail message. Prefixed so
        // the row is recognizable and can never collide with real Gmail ids.
        gmailMessageId: `quick-reply-${randomUUID()}`,
        fromAddress: parseEmailAddress(input.staffEmail),
        toAddresses: [input.recipientEmail.toLowerCase()],
        subject: input.subject,
        snippet: (input.bodyText || '').slice(0, 200) || null,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        bodySource: input.bodyText ? 'plain' : 'html-converted',
        direction: 'outbound',
        sentAt: now,
        isRead: true,
        status: 'TRIAGED',
        triageAt: now,
      },
      select: { id: true },
    })

    // Same thread-state contract the pubsub handler maintains. Quick
    // Replies are sent "now" so this send is the latest message by
    // construction — a plain set is safe.
    const thread = await prisma.emailThread.update({
      where: { id: threadId },
      data: {
        lastMessageAt: now,
        messageCount: { increment: 1 },
        lastOutboundAt: now,
        lastDirection: 'OUTBOUND',
      },
      select: { id: true, gmailThreadId: true },
    })

    const respondedInquiryIds = await markInquiriesRespondedForThread({
      threadKeys: [thread.id, thread.gmailThreadId],
      staffEmail: input.staffEmail,
      at: now,
    })
    return { emailMessageId: created.id, respondedInquiryIds }
  } catch (err) {
    console.warn(
      '[recordQuickReplyOnThread] failed (non-blocking):',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
