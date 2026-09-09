/**
 * Who a client pays, and what the top of a client-facing document calls us.
 *
 * Wes, 2026-09-04: "SirReel Production Vehicles" must never appear
 * client-facing — the entity name belongs only in contract legal text.
 * See CLIENT_SIGNOFF in src/lib/email/signoff.ts for the email half of
 * the same ruling.
 *
 * A money document is the one place that ruling has to bend, and the
 * 2026-09-09 audit of the invoice PDF is why. That page carried BOTH
 * names at once: "SirReel Production Vehicles, Inc." in the top band
 * under the logo, and "SirReel Studio Services" in Remit To, in the
 * payment-terms line, in the check instructions and in the footer —
 * while the Zelle panel on the same page named the entity again.
 *
 * The bank is the tiebreaker. SiteSetting holds:
 *
 *   paymentPayeeName  "SirReel Production Vehicles Inc"  (Bank of America)
 *   paymentZelleName  "SIRREEL PRODUCTION VEHICLES INC"
 *
 * So the invoice was telling clients to cut a check to a name that is
 * not the name on the receiving account. Wes ruled on 2026-09-09: the
 * money lines carry the DBA form, so the client reads the brand they
 * know and AP — and the teller depositing the check — sees the name the
 * account is actually under.
 */

/**
 * The brand. Use this for the top band of a client document, a footer,
 * a heading — anywhere the page is naming us rather than routing money.
 */
export const BRAND_NAME = 'SirReel Studio Services'

/**
 * The qualifier alone, for the text fallback under the wordmark when a
 * PDF's logo asset fails to load. Mirrors how the logo itself sets the
 * name: "SirReel" over "STUDIO SERVICES". When the logo DOES load it
 * already carries both words, so nothing should render under it.
 */
export const BRAND_QUALIFIER = 'Studio Services'

/** The legal entity, on its own. Only ever a component of the lines below. */
export const LEGAL_ENTITY_NAME = 'SirReel Production Vehicles, Inc.'

/**
 * The payee, for an INLINE "payable to …" sentence — the payment-terms
 * line and the check instructions.
 *
 * Do not use this as a brand label, a signoff or a page heading. It
 * exists to make a payment land in the right account, and it is the
 * only client-facing string outside contract legal text that is allowed
 * to carry the entity name.
 */
export const REMIT_TO_NAME = `${BRAND_NAME} (${LEGAL_ENTITY_NAME})`

/**
 * The same fact for a STACKED remit block, where the parenthetical form
 * would wrap to three bold lines in a narrow column. Renders as a small
 * muted line under the brand — the conventional position for a dba line
 * on an invoice.
 */
export const REMIT_TO_DBA_LINE = `a dba of ${LEGAL_ENTITY_NAME}`
