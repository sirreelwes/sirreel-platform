/**
 * Company name normalization — the analog of email-normalize for
 * the people table. Computes a fuzzy-match key that strips:
 *
 *   - case
 *   - leading / trailing whitespace
 *   - punctuation (commas, periods, ampersands, etc.)
 *   - common trailing legal suffixes (LLC, Inc., Corp., etc.)
 *   - generic industry words used as suffixes (Productions, Films,
 *     Studios, Media, Entertainment, Group, Pictures, Company, Co)
 *
 * Used as the dupe-guard at the **company create endpoint** (the
 * source of dupes) AND as the type-ahead match key on the front end
 * (the human-surfaced near-match check). Same function in both places
 * — no drift possible.
 *
 * No column added. Key is computed on the fly. We have ~hundreds of
 * Companies, not millions; an in-memory pass at write time is fine.
 *
 * Compatible with the local fuzzy logic that was previously inlined
 * in `src/app/api/orders/parse-quote/route.ts:624-636` — that path
 * should be migrated to consume this helper in a follow-up cleanup.
 */

// Common trailing tokens that don't disambiguate a company. Order
// matters slightly (longer first) so multi-word suffixes are stripped
// in one pass: "ProductionS" before "S".
const SUFFIX_TOKENS = [
  'corporation',
  'productions',
  'production',
  'entertainment',
  'pictures',
  'studios',
  'studio',
  'company',
  'films',
  'film',
  'media',
  'group',
  'llc',
  'inc',
  'llp',
  'ltd',
  'corp',
  'co',
]

export function companyNameKey(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = raw.toLowerCase()
  // Smart quotes / curly apostrophes → straight forms before strip.
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
  // Strip everything that isn't [a-z0-9 ] — punctuation, ampersands,
  // slashes, etc. all collapse to spaces.
  s = s.replace(/[^a-z0-9 ]+/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return ''

  // Tokenize, walk from the end, strip suffix tokens repeatedly.
  // "rema films llc" → "rema films" → "rema"
  // "the morning show productions" → "the morning show"
  let tokens = s.split(' ')
  while (tokens.length > 1 && SUFFIX_TOKENS.includes(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1)
  }
  // For very short remainder (single token after strip) we DON'T also
  // strip leading articles — "The Apartment" stays distinguishable
  // from "Apartment Productions" once both fold to "apartment".
  return tokens.join(' ').trim()
}

/**
 * Returns true iff the two names normalize to the same key. Used as
 * the dupe-guard predicate at create time + the type-ahead pre-match
 * highlight rule.
 */
export function companyNamesMatch(a: string, b: string): boolean {
  const ka = companyNameKey(a)
  const kb = companyNameKey(b)
  if (!ka || !kb) return false
  return ka === kb
}
