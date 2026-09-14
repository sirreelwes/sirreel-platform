/**
 * Sandbags with every tent.
 *
 * Wes 2026-09-13: "Whenever we rent tents, we want to offer sandbags. So
 * if someone is using the order form and chooses tents, make sure the
 * sandbags show in the options. Typically it's [four] sandbags per
 * 10 x 10 tent and six sandbags per 10 x 15 tent, and eight sandbags per
 * 10 x 20 tent."
 *
 * The 10x10 count arrived as "it's for sandbags" and was read as FOUR;
 * the 8x8 he did not name at all. Both were shipped as inferences and
 * both were CONFIRMED by Wes on 2026-09-14 ("10x10 is four, 8x8 is four
 * — confirmed"), so every number in the table below is now his, not a
 * reading of his.
 *
 * ONE PER LEG is the real rule behind those numbers — a 10x10 pop-up
 * stands on 4 legs, a 10x15 on 6, a 10x20 on 8 — which is why this is a
 * table and not arithmetic. No formula over the width and length
 * reproduces all three AND an 8x8 (which has 4 legs, not 3.2), so a
 * formula here would be false precision that quietly mis-ballasts a tent.
 * An unlisted size offers NOTHING rather than a guessed count: a rep who
 * sees no offer asks, a rep who sees a wrong number ships it.
 *
 * OFFERED, never auto-added. Sandbags are billable ($3–$5/day), and Wes's
 * word is "offer" — the count is computed for the rep, the decision stays
 * theirs. Tents get staked instead on some locations.
 *
 * Pure and prisma-free, like tentFirst.ts beside it, so the staff order
 * form and any client-facing surface can share one answer.
 */

import { tentRole } from '@/lib/sales/tentFirst'

/**
 * Sandbags per tent, by footprint. Keys are normalized "WxL" with the
 * smaller number first, so "10 x 15" and "15x10" are one entry.
 *
 * Every value is Wes's, confirmed 2026-09-14. The 8x8 was originally
 * inferred from the leg count it shares with a 10x10; he has since
 * confirmed the four, so it is no longer an assumption to revisit.
 */
export const SANDBAGS_BY_SIZE: Record<string, number> = {
  '8x8': 4,
  '10x10': 4,
  '10x15': 6,
  '10x20': 8,
}

/**
 * The footprint written into a catalog name, normalized to "WxL".
 *
 * The catalog spells the same tent six ways — "Caravan Canopy - 10' x 15'
 * Tent, White", "Caravan Canopy, 10x15", "Caravan Canopy -10' x 10',
 * Black", "Caravan Canopy - 10' x 20, Blue" and the two typo'd rows
 * "Caravan Canopy - 8' x '8 Tent, Black" and "8' x 8'". Feet marks are
 * noise, so they come out before the pair is read.
 */
export function tentFootprint(name: string): string | null {
  const cleaned = name.toLowerCase().replace(/['’`"]/g, ' ')
  const m = cleaned.match(/\b(\d{1,3})\s*(?:ft|feet|foot)?\s*x\s*(\d{1,3})\b/)
  if (!m) return null
  const a = parseInt(m[1], 10)
  const b = parseInt(m[2], 10)
  if (!a || !b) return null
  // Smaller side first so "10x15" and "15x10" are the same tent.
  return a <= b ? `${a}x${b}` : `${b}x${a}`
}

/**
 * Sandbags for ONE of this catalog row, or null when this row is not a
 * tent we ballast.
 *
 * Gated on tentRole being SHELTER, which is what keeps the accessories
 * out: "Sidewalls, 10x15" carries a footprint too, and a sidewall does
 * not need its own sandbags — it hangs off a tent that already has them.
 */
export function sandbagsPerTent(name: string): number | null {
  if (tentRole(name) !== 'SHELTER') return null
  const size = tentFootprint(name)
  if (!size) return null
  return SANDBAGS_BY_SIZE[size] ?? null
}

export interface SandbagOffer {
  /** Footprint the count came from — shown to the rep so a wrong catalog
   *  name is visible rather than mysterious. */
  size: string
  perTent: number
  /** perTent × the tent line's quantity: three 10x20s need 24 bags. */
  total: number
}

/** The offer for a tent line, or null when there is nothing to offer. */
export function sandbagOffer(name: string, tentQuantity: number): SandbagOffer | null {
  const perTent = sandbagsPerTent(name)
  if (!perTent) return null
  const qty = Number.isFinite(tentQuantity) ? Math.floor(tentQuantity) : 1
  const tents = Math.max(1, qty)
  const size = tentFootprint(name)
  if (!size) return null
  return { size, perTent, total: perTent * tents }
}

/**
 * Is this catalog row a sandbag? Used to RESOLVE which row to offer, so
 * it reads the several spellings the catalog actually carries: "Sand
 * Bags, 25lbs" (the tents-accessories rows) and "25 LB. SANDBAG" (the
 * older grip rows).
 */
export function isSandbagItem(name: string): boolean {
  return /\bsand ?bags?\b/i.test(name)
}
