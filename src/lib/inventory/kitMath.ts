/**
 * Kit-piece ratio arithmetic — the whole of it.
 *
 * Split out from kitPieces.ts (which imports Prisma) so the inventory
 * drawer can render a live preview of a ratio without dragging the DB
 * client into the browser bundle.
 */

export interface KitRatio {
  qtyPer: number
  perUnits: number
  rounding: 'CEIL' | 'FLOOR'
  minQty: number
}

/**
 * How many pieces ride along with `parentQty` of the parent item.
 *
 * Rounding direction is per-piece and both directions matter: spare
 * batteries at 0.5-per-1 CEIL give 15 radios 8 spares (never 7), while
 * a charging bank at 1-per-12 FLOOR with minQty 1 gives 13 radios one
 * bank and 5 radios one bank rather than none.
 *
 * A parent line of zero gets nothing — minQty is a floor on a kit that
 * exists, not a reason to ship gear for an item nobody rented.
 */
export function resolveKitQuantity(ratio: KitRatio, parentQty: number): number {
  const parent = Math.floor(parentQty)
  if (!Number.isFinite(parent) || parent <= 0) return 0
  const per = ratio.perUnits > 0 ? ratio.perUnits : 1
  const raw = (parent / per) * ratio.qtyPer
  const rounded = ratio.rounding === 'FLOOR' ? Math.floor(raw) : Math.ceil(raw)
  return Math.max(0, Math.max(ratio.minQty, rounded))
}

/** "1 per 12, rounded down (min 1)" — the ratio in one human line. */
export function describeKitRatio(ratio: KitRatio): string {
  const per = ratio.perUnits > 1 ? ` per ${ratio.perUnits}` : ' per 1'
  const round = ratio.rounding === 'FLOOR' ? 'rounded down' : 'rounded up'
  const min = ratio.minQty > 0 ? `, min ${ratio.minQty}` : ''
  return `${ratio.qtyPer}${per}, ${round}${min}`
}
