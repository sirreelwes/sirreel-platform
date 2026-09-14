/**
 * "Tent first, then the accessories."
 *
 * Wes 2026-09-13: "Whenever tent, Canopy, pop-up are entered. The order
 * form should offer the tent first and the accessories like side walls
 * next."
 *
 * WHY this needs a rule at all. The catalog holds ~30 canopy rows (every
 * size in every color), 8 "Canopy Tent Sidewall" rows and the seeded
 * "Sidewalls, NxN" / "Sand Bags, Nlbs" rows — and the words overlap in
 * the worst possible way. Three things went wrong at once in the picker:
 *
 *   · A SIDEWALL is literally named "Canopy Tent Sidewall - 10' Black",
 *     so it hit the query on its NAME while the seeded shelter row
 *     "Caravan Canopy, 10x10" hit only via its alias. Name evidence wins
 *     in the relevance pass, so the accessory sorted ABOVE the tent.
 *   · Ties fall through to "shorter name wins", and the accessory names
 *     are shorter. Same outcome by a second route.
 *   · The dropdown is capped at 10. Rank the canopies to the top and the
 *     accessories fall off the end entirely — "next" has to still be ON
 *     the list to mean anything, so the accessory tier gets reserved
 *     slots rather than whatever is left over.
 *
 * Pure and prisma-free on purpose: the staff typeahead (/api/catalog/
 * search) and the client-facing supply order form both rank with this,
 * so the two surfaces cannot disagree about what "tent" offers. Same
 * reason queryTokens.ts is split out of catalogMatcher.ts.
 */

export type TentRole = 'SHELTER' | 'ACCESSORY' | 'OTHER'

/** The InventoryCategory that holds the tent family. */
export const TENT_CATEGORY_SLUG = 'tents-accessories'

/**
 * Dropdown slots held for the accessory tier when the shelters would
 * otherwise fill the whole list. Three is what it takes to show a
 * sidewall or two and the sandbags without burying the tents.
 */
export const TENT_ACCESSORY_SLOTS = 3

/**
 * Fold punctuation to spaces so one pattern set reads both the catalog's
 * spelling and the rep's: "Caravan Canopy - 8' x '8 Tent, Black" and
 * "pop-up" normalize to plain words.
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * The words that MEAN a shelter. Also the trigger set — a query counts as
 * a tent query when it names one of these, which is what keeps "what the
 * rep typed" and "what we call a tent" one list instead of two.
 *
 * `pop ?ups?` reads "popup", "pop up" and (post-normalize) "pop-up".
 */
const SHELTER_PATTERNS: RegExp[] = [
  /\btents?\b/,
  /\bcanop(?:y|ies)\b/,
  /\bpop ?ups?\b/,
  /\bez ?ups?\b/,
  /\bmarquees?\b/,
  /\bshade structures?\b/,
]

/**
 * The things that go WITH a tent. Checked FIRST, because every one of
 * these rows also carries a shelter word — "Canopy Tent Sidewall" is not
 * a canopy and not a tent, it is the wall that hangs off one.
 */
const ACCESSORY_PATTERNS: RegExp[] = [
  /\bside ?walls?\b/,
  /\bwalls?\b/,
  /\bsand ?bags?\b/,
  /\bweights?\b/,
  /\bstakes?\b/,
  /\bspikes?\b/,
  /\banchors?\b/,
  /\btie ?downs?\b/,
  /\bguy ?lines?\b/,
  /\bgutters?\b/,
]

/**
 * True when this query means "show me tents" — the whole rule is gated on
 * it, so nothing about any other search changes.
 *
 * A query that names the ACCESSORY is not one of these, even when it also
 * says tent: "tent sidewall" and "canopy sandbags" are a rep who already
 * knows what they want, and putting the tents above their answer would be
 * the same burial in the other direction. The rule is for the bare word.
 */
export function isTentFamilyQuery(query: string): boolean {
  const n = normalize(query)
  if (!n) return false
  if (ACCESSORY_PATTERNS.some((re) => re.test(n))) return false
  return SHELTER_PATTERNS.some((re) => re.test(n))
}

/**
 * What a catalog row IS within the tent family, read off its name.
 *
 * ACCESSORY is tested before SHELTER on purpose (see above). OTHER is
 * everything that came back on a tent query without being either — an
 * alias or code hit — and sorts last.
 */
export function tentRole(name: string): TentRole {
  const n = normalize(name)
  if (ACCESSORY_PATTERNS.some((re) => re.test(n))) return 'ACCESSORY'
  if (SHELTER_PATTERNS.some((re) => re.test(n))) return 'SHELTER'
  return 'OTHER'
}

const TIER: Record<TentRole, number> = { SHELTER: 0, ACCESSORY: 1, OTHER: 2 }

/** Sort rank for a row on a tent query: 0 shelter, 1 accessory, 2 other. */
export function tentTier(name: string): number {
  return TIER[tentRole(name)]
}

export interface OrderTentFirstOptions<T> {
  /** How to read the display name off a hit. */
  name: (hit: T) => string
  /**
   * How many hits the caller will actually SHOW. Given, the accessory
   * tier is guaranteed `minAccessories` of them and the return value is
   * already sliced. Omit when the caller renders everything (the public
   * order form does) — then this only reorders.
   */
  limit?: number
  /** Slots reserved for accessories when `limit` binds. */
  minAccessories?: number
}

/**
 * Reorder search hits so a tent query offers the tents, then the
 * accessories, then anything else. A NON-tent query is returned exactly
 * as it came in — this never reorders a search for tables.
 *
 * Stable within each tier: whatever relevance order the caller computed
 * survives inside the shelters and inside the accessories.
 */
export function orderTentFirst<T>(
  hits: T[],
  query: string,
  opts: OrderTentFirstOptions<T>,
): T[] {
  if (!isTentFamilyQuery(query)) return hits

  const shelters: T[] = []
  const accessories: T[] = []
  const others: T[] = []
  for (const hit of hits) {
    const role = tentRole(opts.name(hit))
    if (role === 'SHELTER') shelters.push(hit)
    else if (role === 'ACCESSORY') accessories.push(hit)
    else others.push(hit)
  }

  const limit = opts.limit
  if (limit === undefined) return [...shelters, ...accessories, ...others]
  if (limit <= 0) return []

  // Hold back slots for the accessories BEFORE the shelters are allowed
  // to fill the list — a reserve taken after the fact is no reserve.
  const reserved = Math.min(opts.minAccessories ?? TENT_ACCESSORY_SLOTS, accessories.length)
  const head = shelters.slice(0, Math.max(0, limit - reserved))
  // Shelters that lost their slot to the reserve go last: they are only
  // reachable when the accessories didn't use the room after all.
  return [...head, ...accessories, ...others, ...shelters.slice(head.length)].slice(0, limit)
}
