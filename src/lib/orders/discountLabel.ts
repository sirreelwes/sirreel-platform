/**
 * How a discount names itself on a client-facing document.
 *
 * A bare "Discount  -$182.25" makes the client do arithmetic to find out
 * what they were actually given, and a rep re-reading a sent quote has
 * the same problem. HQ's discount panel has always shown the rate in
 * parentheses; this puts the same thing on the quote and the invoice
 * (Wes, 2026-08-29).
 *
 * Only PERCENT gets a suffix. A FIXED discount's rate IS the amount
 * already printed in the money column, and a FLAT_TOTAL has no rate at
 * all — it's a target grand total, and the implied percentage moves
 * every time a line changes, so printing one would be a number the
 * client could never reproduce.
 */

export type DiscountLabelInput = {
  label: string | null | undefined
  type: 'PERCENT' | 'FIXED' | 'FLAT_TOTAL' | string
  value: number
  /** Used when `label` is blank. */
  fallback?: string
}

/** Trims a rate to the shortest honest form: 30 not 30.00, 12.5 not 12.50. */
function fmtRate(value: number): string {
  return String(Number(value.toFixed(2)))
}

export function discountDisplayLabel({
  label,
  type,
  value,
  fallback = 'Discount',
}: DiscountLabelInput): string {
  const base = (label ?? '').trim() || fallback
  if (type !== 'PERCENT') return base
  if (!Number.isFinite(value) || value <= 0) return base
  // Don't double up when someone already typed the rate into the label.
  if (base.includes('%')) return base
  return `${base} (${fmtRate(value)}%)`
}
