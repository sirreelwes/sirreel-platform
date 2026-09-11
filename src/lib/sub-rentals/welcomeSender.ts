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

import type { PartnerKindKey } from '@/lib/sub-rentals/partnerKind'

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
 * ── It is FIRST CONTACT, in Wes's words ─────────────────────────────────────
 * Wes 2026-09-11: "Let's change this into an email that is the first contact.
 * Hi, it's Wes Bailey from SirReel...." — and then, on the next cut, the tone
 * he wanted, given as the email itself: "SirReel has been offering solutions
 * to production clients in Los Angeles for 30 years and we are always looking
 * for a way to offer more. We think Saniset could be a partner in that goal.
 * Here's how it would work: SirReel begins to feature your products and
 * services on their website and communications with clients. When a client
 * orders, we get that info instantly to Saniset. Confirmation can be done via
 * email or text and we handle all client contracts, insurance and interaction
 * and provide you with a portal where you can confirm it. That same portal
 * gives you delivery information, site contact and any instructions from the
 * client. At the end of the job, we bill the client, collect the money and
 * pass it along to you minus our percentage. I'd love to show you how I think
 * this could be a win/win!"
 *
 * So the body below IS that, with the partner's name in the two places his
 * had "Saniset" and the percentage filled in where the deal is set. It walks
 * the flow in order — feature, order, confirm, deliver, bill, pay — which is
 * the order the partner will live it in. No page tour, no paperwork list;
 * those are the account-link email's, once they say yes.
 *
 * It carries the NUMBERS when the deal is set, because a term nobody wrote down
 * is a term that gets re-negotiated later. When it isn't set, "our percentage"
 * stays as he wrote it, with a clause that it is agreed before anything books.
 *
 * Still NO account link — that is the second mail. The lock in sendVendorInvite
 * depends on this one having gone.
 *
 * "SirReel", never "SirReel Production Vehicles" — the entity name belongs in
 * contract legal text and nowhere a partner reads.
 */
/** Stacked like his real email signature (Wes 2026-09-11, screenshot):
 *
 *    Wes Bailey
 *    Founder & CEO | SirReel Studio Services
 *    M: 760.672.5522
 *    E: wes@sirreel.com
 *
 *  No dash before the name and no bare "SirReel" line (Wes, earlier the
 *  same day) — the title line is the signature's own. Address, office line,
 *  hours and the link row stay out: the shell's footer carries the address
 *  and office number, and the rest is signature furniture, not a letter's.
 *  Whichever of the contacts are known are printed; a missing one is
 *  skipped rather than printed blank. */
export function signOff(name: string, phone?: string | null, email?: string | null, title?: string | null): string {
  return [
    name,
    title?.trim() || null,
    phone?.trim() ? `M: ${signaturePhone(phone)}` : null,
    email?.trim() ? `E: ${email.trim()}` : null,
  ].filter(Boolean).join('\n')
}

/** 760-672-5522 / (760) 672-5522 / 7606725522 → 760.672.5522, the way his
 *  signature writes it; anything that is not ten digits passes through. */
export function signaturePhone(raw: string): string {
  const d = raw.replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return ten.length === 10 ? `${ten.slice(0, 3)}.${ten.slice(3, 6)}.${ten.slice(6)}` : raw.trim()
}

/** The title line under his name, as his signature has it. Only the owner
 *  sends this mail (the allowlist above), so the one title lives here. */
export const WES_SIGNATURE_TITLE = 'Founder & CEO | SirReel Studio Services'

export function buildIntroDraft(a: {
  vendorName: string
  contactName: string | null
  kind?: PartnerKindKey
  /** Full name — it introduces him ("It's Wes Bailey from SirReel"). */
  senderName: string
  /** His cell and address, for the sign-off (Wes 2026-09-11: "Add my cell
   *  and email address"). The cell is User.phone on his row; when it is
   *  not set the sign-off carries the email alone rather than a blank. */
  senderPhone?: string | null
  senderEmail?: string | null
  /** The line under his name ("Founder & CEO | SirReel Studio Services"). */
  senderTitle?: string | null
  /** SirReel's share, when the deal is set. Their share is the remainder. */
  sharePercent?: number | null
}): IntroDraft {
  const first = a.contactName?.trim().split(/\s+/)[0] || null
  const greeting = first ? `Hi ${first},` : `Hello,`

  const share = a.sharePercent
  const settle =
    share == null
      ? `At the end of the job, we bill the client, collect the money and pass it along to you minus our percentage, which we'd agree on before anything is booked.`
      : `At the end of the job, we bill the client, collect the money and pass it along to you within 30 days, minus our ${share}%.`

  return {
    subject: `SirReel wants to be your outside sales partner!`,
    body: [
      greeting,
      `It's ${a.senderName} from SirReel. SirReel has been offering solutions to production clients in Los Angeles for 30 years, and we are always looking for a way to offer more. We think ${a.vendorName} could be a partner in that goal.`,
      `Here's how it would work: SirReel begins to feature your products and services on our website and in our communications with clients. When a client orders, we get that information to ${a.vendorName} instantly. Confirmation can be done by email or text, and we handle all client contracts, insurance and interaction, and provide you with a portal where you can confirm it. That same portal gives you the delivery information, the site contact and any instructions from the client. ${settle}`,
      `I'd love to show you how I think this could be a win/win!`,
      signOff(a.senderName, a.senderPhone, a.senderEmail, a.senderTitle),
    ].join('\n\n'),
  }
}
