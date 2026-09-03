/**
 * Is the stored quote PDF still an honest picture of the order?
 *
 * The quote PDF is a BLOB, rendered once and stored on the Order
 * (quotePdfKey/quotePdfUrl/quotePdfGeneratedAt). Nothing re-renders it
 * when the order changes — not editing a line, not moving a department,
 * not adding a discount. "Preview" serves that blob, and `send-quote`
 * only checks that one EXISTS before pointing the client's portal at it.
 *
 * So a rep can rework an order all afternoon and send the client a
 * document from that morning, with the old prices, the old day counts,
 * and line items that have since been deleted. On 2026-08-29 Wes hit
 * exactly this: the stored PDF for S260828-003 was ~20 hours stale, and
 * the only clue was a "Last generated" timestamp nobody reads as a
 * warning.
 *
 * Staleness is "the order moved after the PDF was cut" — measured
 * against the order row AND its line items AND its discounts, because
 * editing a line does not necessarily touch Order.updatedAt.
 *
 * ── Two different kinds of stale ────────────────────────────────────
 * CONTENT staleness is the one above: the order changed, so the stored
 * PDF shows the wrong prices. That is a money error and sending it is
 * worse than refusing.
 *
 * FORMAT staleness is new (2026-09-03). The DOCUMENT changed, not the
 * order — the booking-details block shipped, and a PDF cut before it
 * carries none of it. An order nobody edits afterward would otherwise
 * send the old document forever, because content staleness cannot see a
 * code deploy. So a PDF older than the template epoch is stale too.
 *
 * Callers that must react differently to the two — see send-quote, which
 * refuses to send a content-stale PDF but WILL send a format-stale one
 * rather than block a rep over a missing terms block — should use
 * quotePdfStaleReason() instead of the boolean.
 */

export type QuotePdfFreshnessInput = {
  quotePdfGeneratedAt: Date | string | null | undefined
  /** Order.updatedAt. */
  updatedAt: Date | string
  lineItems?: { updatedAt: Date | string }[]
  discounts?: { updatedAt: Date | string }[]
}

const ms = (d: Date | string): number =>
  (typeof d === 'string' ? new Date(d) : d).getTime()

/**
 * When the quote PDF template last changed in a way clients must see.
 *
 * Bump this on any change to QuoteDocument or to what generateQuotePdf
 * feeds it that a client would notice — and ONLY then. Every stored PDF
 * older than this re-renders on the next preview or send, so a careless
 * bump re-cuts every quote blob in the system.
 *
 * 2026-09-03 — the Booking Details block (lot hours, rental cycle,
 * mileage, LCDW, cancellation, card fee) shipped.
 */
export const QUOTE_PDF_TEMPLATE_EPOCH = Date.UTC(2026, 8, 3)

export type QuotePdfStaleReason = 'content' | 'format'

/** Newest mutation timestamp across the order and everything it prices. */
export function orderContentTouchedAt(input: QuotePdfFreshnessInput): number {
  return Math.max(
    ms(input.updatedAt),
    ...(input.lineItems ?? []).map((l) => ms(l.updatedAt)),
    ...(input.discounts ?? []).map((d) => ms(d.updatedAt)),
  )
}

/**
 * True when the stored PDF predates the order's current content.
 *
 * A missing PDF is NOT "stale" — it's absent, which callers already
 * handle separately and with a different message.
 *
 * The one-second tolerance absorbs the write-ordering inside the
 * generate route itself: it renders, uploads, then stamps the order,
 * so `updatedAt` legitimately lands a few hundred ms AFTER
 * `quotePdfGeneratedAt` on a perfectly fresh render.
 */
export function isQuotePdfStale(input: QuotePdfFreshnessInput): boolean {
  return quotePdfStaleReason(input) !== null
}

/**
 * WHY the stored PDF is stale, or null when it is current.
 *
 * 'content' is checked first: when the order has also moved, the wrong
 * prices are the more serious problem and the more urgent message.
 */
export function quotePdfStaleReason(
  input: QuotePdfFreshnessInput,
): QuotePdfStaleReason | null {
  if (!input.quotePdfGeneratedAt) return null
  const generated = ms(input.quotePdfGeneratedAt)
  if (!Number.isFinite(generated)) return null
  if (orderContentTouchedAt(input) > generated + 1000) return 'content'
  if (generated < QUOTE_PDF_TEMPLATE_EPOCH) return 'format'
  return null
}
