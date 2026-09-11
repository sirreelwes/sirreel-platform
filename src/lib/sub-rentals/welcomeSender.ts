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
 * ── It follows a phone call ─────────────────────────────────────────────────
 * Wes 2026-09-10: "I am going to reach out by phone before I send this email,
 * so no need to introduce myself. Let's jump into the meat." So this does NOT
 * explain who SirReel is or what we do — a man who just spoke to the owner does
 * not need telling. It is the written version of the conversation: the split,
 * what it costs their customer (nothing), what they get, and the two things we
 * need back.
 *
 * It carries the NUMBERS when the deal is set, because a term nobody wrote down
 * is a term that gets re-negotiated later. When it isn't set, the sentence says
 * so plainly rather than inventing a percentage.
 *
 * Still NO account link — that is the second mail, once they say yes. The lock
 * in sendVendorInvite depends on this one having gone.
 *
 * "SirReel", never "SirReel Production Vehicles" — the entity name belongs in
 * contract legal text and nowhere a partner reads.
 */
export function buildIntroDraft(a: {
  vendorName: string
  contactName: string | null
  kind?: PartnerKindKey
  senderName: string
  /** SirReel's share, when the deal is set. Their share is the remainder. */
  sharePercent?: number | null
}): IntroDraft {
  const words = partnerVocab(a.kind ?? 'VEHICLES')
  const first = a.contactName?.trim().split(/\s+/)[0] || null
  const greeting = first ? `Hi ${first},` : `Hello,`

  const share = a.sharePercent
  const theirs = share == null ? null : Math.round((100 - share) * 100) / 100
  const splitLine =
    share == null
      ? `Your listed rate is what the production pays. Our share comes out of that rate rather than being added on top of it — so coming through us costs your customer nothing. I'll confirm the exact split with you before anything is booked.`
      : `Your listed rate is what the production pays. You receive ${theirs}% of it and SirReel keeps ${share}%, invoiced to us after each booking comes back and paid within 30 days. Our share comes out of that rate rather than being added on top of it — so coming through us costs your customer nothing, and there is no version of this where they save money by going around me.`

  const ancillaries = words.drivers
    ? `Delivery, mileage, generator hours and driver time bill on top at the rates you set, and those are yours in full.`
    : `Delivery and collection, fuel, cable and technician time bill on top at the rates you set, and those are yours in full.`

  return {
    subject: `SirReel wants to partner with ${a.vendorName}!`,
    body: [
      greeting,
      `Good speaking with you. Here is what I described, in writing, so you have it in front of you.`,
      splitLine,
      ancillaries,
      `The reason productions like this: they sign one agreement with us, send us one certificate of insurance and get one invoice. They never have to set you up as a new vendor, and your ${words.many} ${words.drivers ? 'are' : 'is'} covered under the same agreement and the same insurance as ours.`,
      `You'd get your own page with us — your ${words.many} and your rates, which stay yours to change any time, your own photos, delivery contacts, and every booking we send your way in one place. Nothing goes out to a client without your rate on it.`,
      `Two things I need from you: the partner agreement signed, and a certificate of insurance naming SirReel. Both live on that page.`,
      `Say the word and I'll send you the link.`,
      `— ${a.senderName}\nSirReel`,
    ].join('\n\n'),
  }
}
