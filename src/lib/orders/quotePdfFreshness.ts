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
  if (!input.quotePdfGeneratedAt) return false
  const generated = ms(input.quotePdfGeneratedAt)
  if (!Number.isFinite(generated)) return false
  return orderContentTouchedAt(input) > generated + 1000
}
