/**
 * Shared plural-tolerant matching for the PUBLIC search surfaces
 * (2026-09-09).
 *
 * Both public entry points — the Home hero pill (/api/public/search) and
 * the order form's own field (/api/public/catalog) — have to answer the
 * same query the same way. They didn't: the hero tokenized the query and
 * carried singular/plural variants, while the catalog route substring-
 * matched the WHOLE raw string against each field. So "walkies" found
 * nothing on the order form ("Walkie, Digital" doesn't contain the
 * plural), while the seed deliberately keeps only the SINGULAR aliases
 * (scripts/seed-catalog-aliases.ts strips "walkies"/"radios" so a bare
 * walkie resolves to the digital row). Crews type the plural.
 *
 * The rule here is the same one the internal typeahead uses: split the
 * query into tokens, expand each into its singular/plural/measure
 * variants, and require EVERY token to hit the row's haystack in one of
 * its forms. Order-insensitive, so "digital walkies" and "walkie digital"
 * both land.
 */

import { mergeMeasureTokens, tokenVariants } from '@/lib/sales/queryTokens'

/** One entry per typed token; each holds that token's accepted spellings. */
export type QueryVariants = string[][]

export function queryVariants(query: string): QueryVariants {
  const tokens = mergeMeasureTokens(query.trim().toLowerCase().split(/\s+/).filter(Boolean))
  return tokens.map(tokenVariants)
}

/** Lowercase the searchable fields into one blob to match against. */
export function haystack(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ').toLowerCase()
}

/** Every token has to hit, in at least one of its spellings. */
export function matchesQuery(hay: string, variants: QueryVariants): boolean {
  if (variants.length === 0) return true
  return variants.every((vs) => vs.some((v) => hay.includes(v)))
}

/**
 * Placement score for ONE token inside a label, best (0) first. Scored per
 * TOKEN, not per whole query — "cargo van" has to rank "Cargo Van" above a
 * page that merely lists both words in its keywords, and whole-string
 * matching can't see that.
 *   0 label starts with it   1 it starts a word in the label
 *   2 it appears mid-word    3 not in the label at all (matched on an
 *                              alias, category or page keyword)
 */
export function placement(label: string, variants: string[]): number {
  const n = label.toLowerCase()
  let best = 3
  for (const v of variants) {
    if (!v) continue
    if (n.startsWith(v)) return 0
    if (new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(label)) best = Math.min(best, 1)
    else if (n.includes(v)) best = Math.min(best, 2)
  }
  return best
}
