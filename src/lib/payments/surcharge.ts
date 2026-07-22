/**
 * Credit-card surcharge — single source of truth.
 *
 * SirReel adds a card processing fee on top of the amount applied to an
 * invoice. The invoice total is NOT changed: the client is charged
 * `base + surcharge` at the gateway, the invoice is credited `base`, and
 * `surcharge` is recorded on the Payment (see Payment.surchargeAmount).
 * Reversals must refund `base + surcharge`.
 *
 * This module is the ONE place the rate lives — imported by the charge
 * routes (server) and the fee-breakdown UI (client) so the number shown
 * to the client always equals the number charged. The disclosure copy in
 * portal terms.ts states "3%" in words; keep them in lockstep.
 */

/** Surcharge rate as a fraction. 0.03 = 3%. */
export const CARD_SURCHARGE_RATE = 0.03

/** Human label for the fee, reused in UI + payment references. */
export const CARD_SURCHARGE_LABEL = '3% card processing fee'

/** Round to cents, half-up, avoiding binary-float drift. */
function toCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * The surcharge on a base amount, in dollars, rounded to cents.
 * computeSurcharge(100) === 3.00
 */
export function computeSurcharge(baseDollars: number): number {
  if (!Number.isFinite(baseDollars) || baseDollars <= 0) return 0
  return toCents(baseDollars * CARD_SURCHARGE_RATE)
}

/**
 * Full breakdown for a base amount: what the invoice is credited (base),
 * the fee (surcharge), and what the card is actually charged (total).
 */
export function surchargeBreakdown(baseDollars: number): {
  base: number
  surcharge: number
  total: number
} {
  const base = toCents(baseDollars)
  const surcharge = computeSurcharge(base)
  return { base, surcharge, total: toCents(base + surcharge) }
}
