/**
 * "Supplied by PowerTrip Rentals" — the ONE place that decides whether a
 * client-facing surface may name the partner behind a unit.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The sub-rental conduit was built to keep two identities apart in both
 * directions: the partner never learns who the production is, and the client
 * never learns whose unit it is. Wes 2026-09-10 retired the second half. It was
 * never going to hold — the partner's decal is on the machine, so the client
 * learns it the first day the unit is on set — and it cost real convenience on
 * the way: anonymous units meant no real photos, no make and model, and copy
 * that read like a placeholder.
 *
 * What actually keeps the client is that going direct saves them nothing. They
 * pay the partner's LIST rate either way (partnerShare.ts: SirReel's share
 * comes out of the partner's side, never on top), and going around us costs
 * them a second agreement, a second certificate and a second invoice.
 *
 * ── The other direction stays shut ──────────────────────────────────────────
 * This module is ONLY about naming the partner TO THE CLIENT. Nothing here
 * opens the reverse: the partner still never sees the production's name,
 * dates-with-client, contacts or rates. See potentialSubRental.ts.
 *
 * ── It is the PARTNER'S permission, not our switch ──────────────────────────
 * Agreement clause 10: SirReel "does not use your name, logo or trademarks in
 * any client-facing material without your written permission." So
 * `Vendor.nameClientFacing` records a permission we were given, and defaults to
 * false. King Kong and PowerTrip may well answer differently — King Kong rents
 * vehicles alongside our own fleet and may prefer to stay quiet, whereas an
 * equipment partner usually wants the marketing. A global unwind would have
 * forced one answer on both.
 *
 * ── Where it applies, and where it deliberately does not ────────────────────
 * Three surfaces honour it, and read it through here so they cannot drift:
 *   · the /vehicles catalog card        (src/lib/site/vehicleCatalog.ts)
 *   · the unlisted /unit/[token] page   (src/lib/sub-rentals/publicUnit.ts)
 *   · the portal's arriving list        (src/lib/portal/deliveries.ts)
 *
 * The QUOTE stays neutral — departmentQuote.ts and generateQuotePdf.ts name no
 * vendor and still shouldn't. It is the one document a client reads while
 * comparing prices, and a supplier's name on it is an invitation, not a
 * credential. The money rule on the unlisted page also stands untouched: rates
 * and discountPercent are margin, not identity, and never reach a client.
 */

/** What a caller must select off the vendor to ask the question. */
export const PARTNER_ATTRIBUTION_SELECT = {
  name: true,
  nameClientFacing: true,
} as const

export interface PartnerAttributionInput {
  name?: string | null
  nameClientFacing?: boolean | null
}

/**
 * The partner's name when they have permitted it, else null.
 *
 * Null is the safe answer and the default for everything: a caller that did
 * not load the vendor, a partner who never gave permission, and a unit we own
 * outright all return null, and every surface renders nothing.
 */
export function partnerAttribution(vendor: PartnerAttributionInput | null | undefined): string | null {
  if (!vendor?.nameClientFacing) return null
  const name = vendor.name?.trim()
  return name ? name : null
}

/** The client-facing sentence, so three surfaces phrase it identically. */
export function suppliedByLine(name: string | null | undefined): string | null {
  return name ? `Supplied by ${name}` : null
}
