/**
 * Who may send a partner introduction — "SirReel wants to partner with
 * PowerTrip!" — and what the draft says.
 *
 * ── Why this is Wes-only, and why it is an email allowlist ──────────────────
 * Wes 2026-09-10. This is not a system notification; it is the owner asking
 * another owner to work together, and it lands before that company has agreed
 * to anything. Sent by the wrong person, or sent twice, it costs the
 * relationship rather than a support ticket.
 *
 * An ALLOWLIST, not `role === 'ADMIN'` — the same load-bearing reason as
 * src/lib/exports/approver.ts: ADMIN is held by both wes@sirreel.com and
 * dani@sirreel.com, so a role check would silently make Dani a second sender,
 * which is exactly what "a Wes only need" excludes. PARTNER_WELCOME_SENDERS
 * lets him delegate during a genuine absence without a deploy; it ADDS to the
 * base list, so he can never lock himself out with it.
 *
 * ── The draft is his, not ours ──────────────────────────────────────────────
 * buildIntroDraft returns a starting point, not a template to send unread. The
 * route takes back whatever he actually typed. A personal approach that reads
 * like mail-merge is worse than no approach.
 */

import { partnerVocab, type PartnerKindKey } from '@/lib/sub-rentals/partnerKind'

const SENDERS_BASE: ReadonlyArray<string> = ['wes@sirreel.com']

function senderSet(): Set<string> {
  const set = new Set<string>(SENDERS_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.PARTNER_WELCOME_SENDERS
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) set.add(e)
  }
  return set
}

/** True only for the human(s) who may introduce SirReel to a partner. */
export function canSendPartnerWelcome(email: string | null | undefined): boolean {
  if (!email) return false
  return senderSet().has(email.toLowerCase())
}

export interface IntroDraft {
  subject: string
  /** Plain text, paragraph per blank line. Edited before sending. */
  body: string
}

/**
 * The opening draft.
 *
 * Deliberately short and specific: what we do, why we want THEM, and what
 * happens next. It does not carry the account link — the link goes in the
 * second mail, once they have said yes, which is the whole point of splitting
 * the two.
 *
 * "SirReel", never "SirReel Production Vehicles" — the entity name belongs in
 * contract legal text and nowhere a partner reads.
 */
export function buildIntroDraft(a: {
  vendorName: string
  contactName: string | null
  kind?: PartnerKindKey
  senderName: string
}): IntroDraft {
  const words = partnerVocab(a.kind ?? 'VEHICLES')
  const first = a.contactName?.trim().split(/\s+/)[0] || null
  const greeting = first ? `Hi ${first},` : `Hello,`

  return {
    subject: `SirReel wants to partner with ${a.vendorName}!`,
    body: [
      greeting,
      `I run SirReel — we rent production vehicles, stages and gear to film, television and commercial productions around Los Angeles. Our clients keep asking us for ${words.many} we don't own, and rather than send them elsewhere I'd rather send them to you.`,
      `Here's what I have in mind. You keep your rates and your calendar; we bring you the work and handle the production side — one agreement, one certificate of insurance, one invoice, so the client never has to set you up as a new vendor. Your listed rate is what the production pays, and our share comes out of our side of it, so working through us costs your customer nothing.`,
      `If that sounds worth a conversation, reply and I'll send you a link to your own partner page — your ${words.many}, your rates, and every booking we put your way, all in one place.`,
      `Either way, glad to know you.`,
      `— ${a.senderName}\nSirReel`,
    ].join('\n\n'),
  }
}
