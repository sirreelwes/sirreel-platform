/**
 * Query tokenization — pure, no DB, safe in a browser bundle.
 *
 * Split out of catalogMatcher.ts (which imports prisma) so the PUBLIC
 * surfaces can share the exact same singular/plural/measurement rules:
 * the order form ranks its results client-side, and importing the
 * matcher there would drag the Prisma client into the browser bundle.
 * catalogMatcher re-exports these, so every existing internal caller is
 * unchanged.
 */

/** A plural token's singular form ("tables" → "table"). */
export function singularize(t: string): string {
  return t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t
}

/**
 * A search token plus the singular forms of it, for callers matching against
 * catalog text with plain `contains`.
 *
 * SirReel names things in the singular ("Table, 6' Folding") and crews ask in
 * the plural ("6' folding tables"), so a literal token match drops the very
 * row the rep is looking for — which is what left the line-item picker
 * showing nothing at all for "6' folding tables".
 */
/**
 * Every way a crew might WRITE the same measurement.
 *
 * The catalog names a table "Table, 4' Folding"; a rep types "4ft table" and
 * the search — which is `contains` per token — finds nothing, because "4ft"
 * is not a substring of "4'". extractSpecs() already normalises these for the
 * AI/fallback matcher, but the typeahead never saw that, so the two disagreed
 * about the same catalog.
 *
 * Feet and inches are the ones that actually bite (tables, drape, ladders);
 * the rest are here because the same mismatch exists for coolers and
 * generators the moment someone types "100qt" against "100 qt".
 */
const MEASURE_UNITS: Array<{ match: RegExp; spellings: (n: string) => string[] }> = [
  {
    match: /^(\d+(?:\.\d+)?)\s*-?\s*(?:'|ft|foot|feet)$/,
    spellings: (n) => [`${n}'`, `${n}ft`, `${n} ft`, `${n}-ft`, `${n} foot`, `${n}-foot`, `${n}feet`, `${n} feet`],
  },
  {
    // Inches BEFORE feet would be wrong the other way round: 6'' is inches.
    match: /^(\d+(?:\.\d+)?)\s*-?\s*(?:''|"|in|inch|inches)$/,
    spellings: (n) => [`${n}"`, `${n}''`, `${n}in`, `${n} in`, `${n}-in`, `${n} inch`, `${n}-inch`, `${n}inches`],
  },
  {
    match: /^(\d+(?:\.\d+)?)\s*-?\s*(?:qt|quart|quarts)$/,
    spellings: (n) => [`${n}qt`, `${n} qt`, `${n}-qt`, `${n} quart`, `${n}quart`],
  },
  {
    match: /^(\d+(?:\.\d+)?)\s*-?\s*(?:gal|gallon|gallons)$/,
    spellings: (n) => [`${n}gal`, `${n} gal`, `${n}-gal`, `${n} gallon`, `${n}gallon`],
  },
  {
    match: /^(\d+(?:\.\d+)?)\s*-?\s*(?:w|watt|watts)$/,
    spellings: (n) => [`${n}w`, `${n} w`, `${n}-w`, `${n} watt`, `${n}watt`],
  },
]

/** Alternate spellings for a measurement token, or [] when it isn't one. */
export function measureVariants(t: string): string[] {
  const base = t.toLowerCase().trim()
  for (const { match, spellings } of MEASURE_UNITS) {
    const m = base.match(match)
    if (m) return spellings(String(parseFloat(m[1])))
  }
  return []
}

/**
 * Fold "4 ft table" into ["4ft", "table"] before the per-token search runs.
 *
 * Without this the bare "ft" is its own token, and since EVERY token has to
 * hit something, one stray unit word empties the dropdown — the same failure
 * mode the plural handling below was written for.
 */
export function mergeMeasureTokens(tokens: string[]): string[] {
  const UNIT_WORD = /^(?:'|''|"|ft|foot|feet|in|inch|inches|qt|quart|quarts|gal|gallon|gallons|w|watt|watts)$/i
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i]
    const next = tokens[i + 1]
    if (/^\d+(?:\.\d+)?$/.test(cur) && next && UNIT_WORD.test(next)) {
      out.push(`${cur}${next.toLowerCase()}`)
      i++
    } else {
      out.push(cur)
    }
  }
  return out
}

export function tokenVariants(t: string): string[] {
  const base = t.toLowerCase()
  const out = new Set([base])
  // Measurement first: "4ft" has no plural, and singularize() would only
  // mangle it.
  const measures = measureVariants(base)
  if (measures.length) {
    for (const m of measures) out.add(m)
    return [...out]
  }
  if (base.length > 3 && base.endsWith('ies')) out.add(`${base.slice(0, -3)}y`)
  if (base.length > 4 && base.endsWith('es')) out.add(base.slice(0, -2))
  out.add(singularize(base))
  return [...out]
}
