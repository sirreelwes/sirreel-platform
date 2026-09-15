/**
 * The one door every partner-facing email goes out through.
 *
 * ── The rule (Wes 2026-09-14) ───────────────────────────────────────────────
 * "The interaction between Wes and Partners should NEVER cc hello@ or hq@. It
 * needs to come from wes@ and have [wes@] as the only reply option."
 *
 * Two things were putting a SirReel shared inbox in front of a partner, and
 * neither was visible from the calling route:
 *
 *  1. CC. Partner sends copy a notification channel — `sub-rental-conduit-cc`
 *     for the conduit, `sales-team-cc` for the lifecycle notices. Those are
 *     ADMIN-EDITABLE at /admin/notifications, so hello@ or hq@ can land on a
 *     partner thread without anybody touching code. Defaults are clean today;
 *     this makes them unable to stop being clean.
 *
 *  2. REPLY-TO. `sendAgreementEmail` quietly APPENDS hello@ to Reply-To for
 *     any on-domain address HQ does not fully ingest — wes@ is exactly that
 *     case. So every mail Wes sent a partner arrived offering two people to
 *     answer, one of them a shared inbox. `replyToExact` turns that off.
 *
 * ── What it costs, deliberately ─────────────────────────────────────────────
 * The hello@ copy was the ANCHOR that let HQ's ingest link a reply to a
 * Resend-sent thread (see sendAgreementEmail's header). Dropping it means a
 * partner's reply to Wes lands in wes@ and is NOT threaded into HQ. That is
 * the trade Wes asked for: partner correspondence is his, and a partner
 * seeing the desk's inbox on a first approach costs more than the thread.
 *
 * ── Why a blocklist and not "just fix the channel" ──────────────────────────
 * Same reasoning as the export allowlist: a default that has to be re-checked
 * every time somebody edits a channel is a default that will be wrong. The
 * addresses are named here once and stripped on the way out.
 */
import { sendAgreementEmail, type EmailPayload, type EmailResult } from '@/lib/email/sendAgreementEmail'
import { hqNotifyInbox } from '@/lib/email/copyRecipients'

/** Wes's own mailbox — the From and the Reply-To on mail he sends a partner. */
export const WES_EMAIL = 'wes@sirreel.com'

/**
 * Shared inboxes a partner must never be shown. hello@ is the first-touch
 * client inbox and the ingest capture address; hq@ is the outbound-only
 * notification group (env-overridable, so it is read at call time).
 */
export function partnerBlockedInboxes(): Set<string> {
  return new Set(['hello@sirreel.com', hqNotifyInbox().trim().toLowerCase()])
}

/** Drop the shared inboxes from a CC list. Everything else passes through. */
export function stripSharedInboxes(cc: readonly string[] | undefined): string[] {
  if (!cc?.length) return []
  const blocked = partnerBlockedInboxes()
  return cc.filter((e) => e && !blocked.has(e.trim().toLowerCase()))
}

/** True when this send is Wes writing to a partner himself. */
export function isWes(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === WES_EMAIL
}

/**
 * The From header for mail Wes personally sends a partner: his address, not
 * `SirReel HQ <notifications@sirreel.com>`. sirreel.com is the verified
 * sending domain, so any mailbox on it is a legal sender.
 *
 * Returns undefined for anyone else — automated partner notices are from the
 * company, and signing them with a person's address would be a lie about who
 * pressed the button.
 */
export function partnerFrom(sender: { email: string | null | undefined; name?: string | null }): string | undefined {
  if (!isWes(sender.email)) return undefined
  const name = sender.name?.trim() || 'Wes Bailey'
  return `${name} <${WES_EMAIL}>`
}

/**
 * Send to a partner (or a partner's driver). Strips the shared inboxes from
 * CC and pins Reply-To to exactly what the caller passed.
 *
 * Use this instead of `sendAgreementEmail` for anything a partner receives.
 */
export async function sendPartnerMail(payload: EmailPayload): Promise<EmailResult> {
  const cc = stripSharedInboxes(payload.cc)
  return sendAgreementEmail({
    ...payload,
    cc: cc.length ? cc : undefined,
    replyToExact: true,
  })
}
