/**
 * Furniture + dolly → Pro Supplies.
 *
 * Wes, 2026-09-04: furniture and dollies bill and browse as Pro
 * Supplies, not G&E — "even the ones a grip uses". This module is the
 * ONE definition of what that sentence covers, so the one-time sweep
 * (scripts/reclassify-furniture-dolly-pro-supplies.ts) and anything that
 * re-checks the catalog later can't disagree about which rows it meant.
 *
 * The consequence is a price change, not just a label: BILLING_RULES
 * (src/lib/orders/billing.ts) bills GE seven days per 7-day window and
 * PRO_SUPPLIES three, so a weekly rental of a moved item bills less.
 *
 * A bare "cart" is deliberately NOT a trigger word: Rubbermaid Carts are
 * already Pro Supplies, while a Lighting Cart and the Grip & Electric
 * Carts are G&E and stay there. The category is named "Dollies & Carts";
 * the RULE is about dollies.
 *
 * Pure string rules — no DB, no Prisma types — so a test can hold it to
 * the real catalog names.
 */

export interface FurnitureDollyCluster {
  key: 'dollies' | 'furniture'
  /** Matched against the item's display name and code together. */
  match: RegExp
  /** InventoryCategory.slug the matched items belong in. */
  categorySlug: string
  note: string
}

/** First match wins. `dollies` is FIRST on purpose: "Dolly, Furniture"
 *  and "Dolly - Furniture (4 Wheel)" match both, and they are dollies. */
export const FURNITURE_DOLLY_CLUSTERS: FurnitureDollyCluster[] = [
  {
    key: 'dollies',
    match: /\bdoll(?:y|ies)\b|\bhand ?truck\b|\bpallet jack\b/i,
    categorySlug: 'dollies-carts',
    note: 'rolls gear — magliners, hand trucks, camera dollies, dolly track, pallet jacks',
  },
  {
    key: 'furniture',
    match: /\bfurniture\b/i,
    categorySlug: 'basecamp-basics',
    note: 'furniture pads + furniture clamps',
  },
]

/**
 * A rack is transport hardware, not the thing it carries — a "Dolly
 * Track Rack" bolts inside a truck and belongs to Vehicle Outfitting.
 * Same carve-out the public order form already makes for a Director's
 * Chair Rack (src/lib/site/publicSupplySections.ts).
 */
export const RACK = /\brack(?:s)?\b/i

export type FurnitureDollyVerdict =
  | { kind: 'move'; cluster: FurnitureDollyCluster }
  | { kind: 'skip'; reason: string }
  | null

/**
 * Does this catalog row belong to the reclassification, and where?
 *
 *   { kind: 'move' } — matched a cluster; move it to that category +
 *                      PRO_SUPPLIES.
 *   { kind: 'skip' } — matched, but deliberately left alone (with why).
 *   null             — not furniture/dolly gear at all.
 */
export function classifyFurnitureDolly(name: string, code = ''): FurnitureDollyVerdict {
  const haystack = `${name} ${code}`
  const cluster = FURNITURE_DOLLY_CLUSTERS.find((c) => c.match.test(haystack))
  if (!cluster) return null
  if (RACK.test(haystack)) return { kind: 'skip', reason: 'a rack, not a dolly' }
  return { kind: 'move', cluster }
}
