/**
 * Who may send a partner introduction — "SirReel wants to be your outside
 * sales partner!" — and what the draft says.
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
 * not need telling.
 *
 * ── It is SHORT, and leads with the pitch ───────────────────────────────────
 * Wes 2026-09-11, on the first cut (nine paragraphs walking the split, the
 * ancillaries, the page, the paperwork): "This is fine for a follow up email.
 * But for the initial email needs to be short and hit the high points: SirReel
 * wants to be your outside Sales Partner! We will feature your equipment on
 * our site, facilitate seamless bookings from our clients to your equipment,
 * etc..." The detail moved to the account-link email, which already carries
 * it. This one is the hook: what we are (their outside sales partner), what we
 * do (feature their gear, bring them the bookings), what we bring (Wes,
 * mid-draft: "highlight that we have 30 years of reputation and customer
 * base!"), what it costs their
 * customer (nothing), what we need back (two things), what happens next.
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
      ? `Your listed rate is what the production pays, and our share comes out of it rather than on top — so it costs your customer nothing to come through us. I'll confirm the exact split with you before anything is booked.`
      : `Your listed rate is what the production pays. You receive ${theirs}% of it and SirReel keeps ${share}%, paid within 30 days of each booking coming back — so it costs your customer nothing to come through us.`

  const ancillaries = words.drivers
    ? `Delivery, mileage, generator hours and driver time are billed at your rates and are yours in full.`
    : `Delivery, fuel, cable and technician time are billed at your rates and are yours in full.`

  return {
    subject: `SirReel wants to be your outside sales partner!`,
    body: [
      greeting,
      `Good speaking with you. The short version, in writing:`,
      `SirReel wants to be ${a.vendorName}'s outside sales partner. We have 30 years of reputation and a customer base in production to put behind your ${words.many}: we feature ${words.drivers ? 'them' : 'it'} on sirreel.com and in our quotes, and we bring you the bookings — our clients book through us, and the job lands on a page of yours with the dates, the location and the contact.`,
      `${splitLine} ${ancillaries}`,
      `Your ${words.many} and your rates stay yours to change any time. The production signs one agreement and sends one certificate — to us — so they never set you up as a vendor, and your ${words.many} ${words.drivers ? 'are' : 'is'} covered under our contract and our insurance while on our job.`,
      `Two things I'll need back: the partner agreement signed, and a certificate of insurance naming SirReel. Both live on your page.`,
      `Say the word and I'll send you the link.`,
      `— ${a.senderName}\nSirReel`,
    ].join('\n\n'),
  }
}
