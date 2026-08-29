/**
 * Does a catalog row's aliases answer this query?
 *
 * Aliases are curated translations between SirReel's name for a thing and
 * the crew's ("garment rack" → "Wardrobe Rack, Rolling"). They live in
 * scripts/seed-catalog-aliases.ts, pinned by row id.
 *
 * The rule is ALIAS ⊆ QUERY: an alias only counts when every word in it
 * is a word the user actually typed, and every token the user typed lands
 * on one of the aliases that qualified.
 *
 * Both halves are load-bearing, and both replace a broken predicate:
 *
 *  - The original `aliases: { has: token }` is EXACT array-element
 *    equality against a whitespace-tokenized, AND-ed query. The token
 *    "garment" can never equal the element "garment rack", so NO
 *    multi-word alias could ever match. "garment rack", "walkie talkie"
 *    and "trash can liner" all returned zero results — the seed's whole
 *    reason for existing, silently inert.
 *
 *  - Substring matching fixes that and immediately overshoots: a bare
 *    "walkie" appears inside the alias "analog walkie", so it drags back
 *    the analog radio alongside the digital one. Wes's 8/17 ruling is
 *    that a bare walkie IS the digital — analog answers to "analog".
 *    Requiring the query to cover the alias keeps them apart.
 */

/** One query token plus its singular/plural variants. */
export type TokenVariants = string[]

const words = (phrase: string): string[] =>
  phrase.toLowerCase().split(/\s+/).filter(Boolean)

export function aliasesAnswerQuery(
  aliases: string[],
  variants: TokenVariants[],
): boolean {
  if (aliases.length === 0 || variants.length === 0) return false

  const queryWords = new Set(variants.flat().map((v) => v.toLowerCase()))

  // Aliases the query fully accounts for — no unmatched alias words.
  const usable = aliases.filter((a) => {
    const w = words(a)
    return w.length > 0 && w.every((x) => queryWords.has(x))
  })
  if (usable.length === 0) return false

  // …and every token the user typed has to land on one of them, so
  // "garment rack blue" doesn't match on the strength of "garment rack".
  const covered = new Set(usable.flatMap(words))
  return variants.every((vs) => vs.some((v) => covered.has(v.toLowerCase())))
}
