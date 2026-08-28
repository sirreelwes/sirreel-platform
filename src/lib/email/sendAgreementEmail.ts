import { Resend } from 'resend'

/**
 * The From: address every client-facing send goes out as. Exported so
 * the preview endpoints can show the agent the SAME string the send
 * route will use — single source of truth.
 */
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { isWatchedInbox } from '@/lib/email/watchedInboxes'
import { inboxMode } from '@/lib/email/ingestFilter'

export const SEND_FROM = 'SirReel HQ <notifications@sirreel.com>'

/**
 * The watched inbox that rides along on Reply-To when the primary
 * Reply-To is an on-domain address HQ does NOT ingest (wes@, hq@).
 * Client replies then land in BOTH places: the human's own mailbox to
 * be answered from, and this one so the ingest pipeline threads the
 * conversation, marks the lead responded, and keeps it out of "new
 * inbound". hello@ specifically: already watched, already the
 * first-touch inbox, and deliberately OUTSIDE CRM capture mining
 * (Wes 2026-08-26 — capture stays scoped to info@/jose@/oliver@).
 *
 * Wes's ruling 2026-08-28: prefer this over ingesting wes@'s inbox —
 * even a "replies only" watch on wes@ can't work, because replies to
 * Resend-sent mail carry an In-Reply-To HQ never stored, so an ingest
 * filter has no way to prove they belong to an HQ conversation.
 */
const REPLY_CAPTURE_INBOX = 'hello@sirreel.com'

/**
 * Effective Reply-To list: pass the caller's value through, appending
 * REPLY_CAPTURE_INBOX when the primary is an on-domain mailbox the
 * ingest doesn't FULLY watch. Off-domain Reply-To (client-as-Reply-To
 * on internal notifies) and fully-ingested inboxes (jose@, billing@, …)
 * go through untouched. A LINKED-mode inbox (wes@) still gets the
 * capture inbox appended even though it's technically watched: its
 * default-drop filter can only keep mail whose Message-ID chain touches
 * a STORED message, and a first reply to a Resend send references only
 * Resend's unstored Message-ID — the hello@ copy is the anchor that
 * makes the rest of the chain linkable.
 */
function effectiveReplyTo(replyTo: string | undefined): string | string[] | undefined {
  if (!replyTo) return undefined
  const primary = replyTo.trim().toLowerCase()
  const onDomain = /^[^\s@]+@sirreel\.com$/.test(primary)
  const fullyIngested = isWatchedInbox(primary) && inboxMode(primary) !== 'LINKED'
  if (!onDomain || fullyIngested || primary === REPLY_CAPTURE_INBOX) return replyTo
  return [replyTo, REPLY_CAPTURE_INBOX]
}

export type EmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: string }

export interface EmailPayload {
  to: string[]
  cc?: string[]
  /** Reply-To header. Used by the thank-you flow to route replies
   * back to the salesperson on the job (their direct watched inbox)
   * instead of notifications@. Optional — when unset, replies fall
   * back to the From: address. */
  replyTo?: string
  subject: string
  html: string
  /** Plain-text alternative. Email clients with HTML disabled (and some
   * filtering rules) show this instead. Improves deliverability. */
  text?: string
  attachments?: { filename: string; content: Buffer }[]
  /** Logging tag — surfaces in console error lines so it's obvious which touchpoint failed. */
  label?: string
  /**
   * Optional anchors recorded on the EmailDelivery row. Pass them when
   * the send belongs to something — the order page reads deliveries by
   * orderId to show its per-send status pills. Callers that already
   * record explicitly can keep doing so; the recorder upserts.
   */
  orderId?: string | null
  invoiceId?: string | null
  quoteFollowUpId?: string | null
}

/**
 * Wraps Resend's `emails.send` so every agreement-related email returns a
 * structured success/failure result instead of throwing past the caller.
 *
 * Why this exists: the SirReel Resend account has had `sirreel.com` sitting
 * unverified since March, which causes every send to fail with "domain not
 * verified" — but our earlier helpers swallowed those errors in a try/catch
 * + console.error, so the failures were invisible to the calling routes and
 * to the admin UI. Returning a result here lets the route bubble the failure
 * into the API response payload (`emailResult` field) where the UI / function
 * logs can actually surface it.
 *
 * Behaviour:
 *  - Missing `RESEND_API_KEY` → `{ ok: false, reason: 'RESEND_API_KEY not set' }`
 *  - Resend throws (network, auth, domain unverified, …) → `{ ok: false, reason: <message> }`
 *  - Resend returns an error object → `{ ok: false, reason: <message> }`
 *  - Success → `{ ok: true, id }`
 */
export async function sendAgreementEmail(payload: EmailPayload): Promise<EmailResult> {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, reason: 'RESEND_API_KEY not set' }
  }
  const resend = new Resend(process.env.RESEND_API_KEY)
  try {
    const result = await resend.emails.send({
      from: SEND_FROM,
      to: payload.to,
      cc: payload.cc,
      replyTo: effectiveReplyTo(payload.replyTo),
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      attachments: payload.attachments,
    })
    if ((result as any)?.error) {
      const errMessage = (result as any).error?.message || JSON.stringify((result as any).error)
      console.error(
        `[email] ${payload.label || 'send'} returned error:`,
        errMessage,
      )
      return { ok: false, reason: errMessage }
    }
    const id = (result as any)?.data?.id ?? null

    // Record EVERY send, not just the order-anchored ones. Before this,
    // 29 of the 34 send sites wrote no EmailDelivery row, so a client
    // saying "I never got the link" was unanswerable — no message id, no
    // status, nothing for the Resend webhook to advance. Best-effort:
    // recordEmailDelivery swallows its own failures, because the mail has
    // already gone out and failing to audit it is not a reason to report
    // the send as failed.
    if (id) {
      await recordEmailDelivery({
        resendMessageId: id,
        toAddress: payload.to[0] ?? '',
        ccAddresses: payload.cc ?? [],
        subject: payload.subject,
        label: payload.label ?? null,
        orderId: payload.orderId ?? null,
        invoiceId: payload.invoiceId ?? null,
        quoteFollowUpId: payload.quoteFollowUpId ?? null,
      })
    }
    return { ok: true, id }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[email] ${payload.label || 'send'} threw:`, reason)
    return { ok: false, reason }
  }
}
