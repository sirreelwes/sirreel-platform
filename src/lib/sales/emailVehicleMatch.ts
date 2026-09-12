/**
 * What an EMAIL asked for, read as a reservation.
 *
 * Wes 2026-09-11, on Luke Gilbert's "VTR Van - Sept 29-Oct 1" landing in
 * the inbound queue with only a Capture & Quote button: "the inquiry that
 * came in didn't see that it should have the reserve and quote option even
 * though 'van' is in the email."
 *
 * It couldn't. `inquiryVehicleRequest.ts` answers the same question for a
 * WEB-FORM request, and it does it off the stored cart — structured lines
 * that already point at catalog rows. An email has no cart, so
 * `vehicleLineCount()` returns 0 for every email that ever arrives and the
 * reserve-first branch is unreachable by construction. The word "van" in
 * the body was never read by anything.
 *
 * It doesn't have to be. The per-message AI extractor has been writing
 * `jobIntent` onto every inbound message for months — Luke's row already
 * held `vehicleType: "VTR Van"`, `pickupDate: "2026-09-29"`,
 * `returnDate: "2026-10-01"` at 0.95 confidence before anyone looked at
 * the card. This module turns that into the same
 * `{ fleetCategoryId, name, quantity }` shape the cart path produces, so
 * both card types can share one reserve branch.
 *
 * PURE AND OFFLINE — the caller supplies the categories. Tested by
 * tests/sales/email-vehicle-match.test.ts.
 *
 * ── Why the matcher is weighted, not literal ────────────────────────
 *
 * `aliasesAnswerQuery` (the typeahead's rule) requires every token the
 * user typed to land on an alias. That is right for a search box and
 * wrong here: a client writes "VTR Van", the curated alias is "vtr", and
 * the loose "van" disqualifies the row the client plainly named. Relaxing
 * it to "any token hits" overshoots the other way — "van" alone is an
 * alias of Cargo Van w/o Liftgate, so every email mentioning a van would
 * preload a hold on a cargo van.
 *
 * So tokens are weighted by how many categories claim them, computed off
 * the category list itself rather than hand-tuned. "vtr" belongs to one
 * category and carries a full point; "van" is in the name or aliases of
 * five and carries a fifth of one. "VTR Van" then resolves to ProScout /
 * VideoVan by a wide margin, and a bare "van" resolves to nothing at all,
 * which is the honest answer — the desk picks.
 */

import { correctImpossibleYear } from '@/lib/orders/parsedDateYear'

/**
 * Extraction confidence below which we don't offer to hold anything.
 *
 * The extractor scores how COMPLETE its read was, and a half-read email
 * is exactly the one whose vehicle and dates shouldn't preload a hold.
 * Matches the reply-classifier's bar (0.75) for the same reason: below
 * it, a human decides. The card falls back to Capture & Quote, which is
 * what it does today — a miss here costs a click, never a wrong hold.
 */
export const MIN_EXTRACTION_CONFIDENCE = 0.75

/**
 * Score floor. One token found in a single category scores 1.0; one
 * found in two scores 0.5. Anything under 0.5 means nothing matched but
 * a word half the fleet answers to ("van", "truck"), which is not an
 * identification.
 */
export const MIN_MATCH_SCORE = 0.5

/** How far clear of the runner-up the winner has to be to be a winner. */
export const AMBIGUITY_RATIO = 1.5

/**
 * A multi-word alias written out verbatim is strong evidence, and a
 * LONGER one is stronger: "cargo van with liftgate" contains "cargo
 * van", so a flat bonus hands both cargo rows the same credit and the
 * ambiguity guard then refuses the row the client spelled out in full.
 * Scored per word beyond the first.
 */
const PHRASE_WORD_BONUS = 0.6

/** A category a hold can be taken against. */
export interface MatchableCategory {
  id: string
  name: string
  aliases: string[]
}

export interface CategoryMatch {
  fleetCategoryId: string
  name: string
  score: number
}

/** The AI extractor's `jobIntent`, as far as we read it. */
interface JobIntent {
  vehicleType?: string | null
  pickupDate?: string | null
  returnDate?: string | null
  projectName?: string | null
}

interface ExtractedData {
  jobIntent?: JobIntent | null
  company?: string | null
  contact?: { name?: string | null; email?: string | null; phone?: string | null } | null
  confidence?: number | null
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Plural → singular, same rule the catalog tokenizer uses. */
const singular = (t: string): string => (t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t)

/**
 * Words that identify nothing, dropped BEFORE weighting.
 *
 * Inverse frequency is fooled by function words, and the fleet's own
 * names are full of them: "Cargo Van w/o Liftgate" contributes "w" and
 * "o", and the alias "cargo van with liftgate" contributes "with". Each
 * belongs to exactly one category, so each scored a full point — which
 * is how "5-ton box truck with lift gate" resolved to a CARGO VAN on
 * the strength of the word "with" (caught against the live inbox,
 * 2026-09-11, before this shipped).
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'with', 'without', 'w', 'o', 'no', 'for', 'of',
  'to', 'in', 'on', 'at', 'by', 'plus', 'per', 'our', 'your', 'need', 'needs',
  'rental', 'rent', 'unit', 'units',
])

/**
 * A bare numeral identifies nothing either, and mis-identifies loudly:
 * "2 ton sprinter or 3 ton box truck" matched the 2 UNIT RESTROOM
 * TRAILER, because "2" appears in exactly one category name and so
 * carried maximum weight. Numbers still count inside a PHRASE ("15
 * passenger van"), which is where they actually mean something.
 */
const isNumeral = (t: string): boolean => /^\d+$/.test(t)

const tokens = (s: string): string[] => norm(s).split(' ').filter(Boolean).map(singular)

/** Tokens that get to vote. */
const scoringTokens = (s: string): string[] =>
  tokens(s).filter((t) => !STOPWORDS.has(t) && !isNumeral(t))

/**
 * Rows that can never be the right answer regardless of score. A
 * category kept alive only so its old units and line items still
 * resolve is not a reservation target — "12-Passenger Van (retired —
 * merged back into Passenger Van)" is live, gantt-reservable, and would
 * otherwise compete with the row it was merged INTO on the very tokens
 * they share.
 */
const isRetired = (name: string): boolean => /\bretired\b/i.test(name)

/**
 * Every token a category answers to, from its name and its aliases.
 */
function categoryTokens(c: MatchableCategory): Set<string> {
  const out = new Set<string>()
  for (const t of scoringTokens(c.name)) out.add(t)
  for (const a of c.aliases) for (const t of scoringTokens(a)) out.add(t)
  return out
}

/**
 * Resolve free text ("VTR Van", "pro scout / video van", "cube truck")
 * to the one category it names, or null when it names none of them or
 * more than one.
 */
export function matchVehicleCategory(
  query: string,
  categories: MatchableCategory[],
): CategoryMatch | null {
  const qTokens = scoringTokens(query || '')
  if (qTokens.length === 0) return null

  const live = categories.filter((c) => !isRetired(c.name))
  if (live.length === 0) return null

  const vocab = live.map((c) => ({ cat: c, tokens: categoryTokens(c) }))

  // How many categories claim each token. Computed off the list rather
  // than a stop-word list, so adding a category re-weights the fleet's
  // shared words automatically.
  const docFreq = new Map<string, number>()
  for (const { tokens: ts } of vocab) {
    for (const t of ts) docFreq.set(t, (docFreq.get(t) ?? 0) + 1)
  }

  const qNorm = norm(query)
  const scored = vocab.map(({ cat, tokens: ts }) => {
    let score = 0
    for (const t of new Set(qTokens)) {
      if (!ts.has(t)) continue
      score += 1 / (docFreq.get(t) ?? 1)
    }
    // A multi-word alias written out verbatim ("cargo van", "cube
    // truck") is the curated translation doing its job — the seed says
    // a bare "cargo van" IS the no-liftgate one, and without this the
    // two cargo rows tie on their shared tokens forever. The LONGEST
    // phrase the client actually wrote is the one that counts.
    if (score > 0) {
      let longest = 0
      for (const a of cat.aliases) {
        const words = norm(a).split(' ').filter(Boolean)
        if (words.length > 1 && qNorm.includes(words.join(' '))) {
          longest = Math.max(longest, words.length)
        }
      }
      if (longest > 1) score += (longest - 1) * PHRASE_WORD_BONUS
    }
    return { fleetCategoryId: cat.id, name: cat.name, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const [top, next] = scored
  if (!top || top.score < MIN_MATCH_SCORE) return null
  // Two categories the text fits equally well is not a match. "Cargo
  // van" without "liftgate" genuinely does not say which one, and a
  // coin-flip hold is worse than the desk picking.
  if (next && next.score > 0 && top.score < next.score * AMBIGUITY_RATIO) return null
  return top
}

/**
 * One client sentence, split into the things it names.
 *
 * "15 pass van, cargo van, 12 pass van" is three asks, and reading only
 * the first understates a three-truck job as one. Split on the
 * conjunctions crews actually type — commas, "and", "+", "&" — and fold
 * what lands on the same category, which is also the reservation
 * modal's own rule (two lines of one category make the second one's
 * capacity check trip over the hold the first just took).
 *
 * NOT split on "/": "Pro Scout / Video Van" and "VTR/Video Van" are one
 * truck written with a slash, and splitting them loses the founding
 * case.
 */
export function readRequestedVehicles(
  requestedAs: string,
  categories: MatchableCategory[],
): { fleetCategoryId: string; name: string; quantity: number }[] {
  // "a cube or a cargo van" is the client offering ALTERNATIVES, not
  // asking for both. Holding either would be guessing, and holding both
  // would be wrong twice — the desk picks.
  if (/\bor\b/i.test(requestedAs)) return []

  const segments = requestedAs
    .split(/,|\band\b|\+|&/i)
    .map((seg) => seg.trim())
    .filter(Boolean)

  const out: { fleetCategoryId: string; name: string; quantity: number }[] = []
  for (const seg of segments) {
    const match = matchVehicleCategory(seg, categories)
    if (!match) continue
    const hit = out.find((o) => o.fleetCategoryId === match.fleetCategoryId)
    if (hit) hit.quantity += 1
    else out.push({ fleetCategoryId: match.fleetCategoryId, name: match.name, quantity: 1 })
  }
  return out
}

export interface EmailVehicleRequest {
  /** What the client called it, verbatim — shown on the card. */
  requestedAs: string
  vehicles: { fleetCategoryId: string; name: string; quantity: number }[]
  start: string | null
  end: string | null
  jobName: string | null
  companyName: string | null
  // The phone rides along to the Job's contact the same way the
  // web-form path carries it (Wes 2026-09-10: the job forgot what the
  // request said). Not a modal field.
  contact: { firstName: string; lastName: string; email: string; phone: string | null } | null
  confidence: number
}

/** Split a typed name into first + last; one word isn't enough. */
function splitName(name: string | null | undefined): { firstName: string; lastName: string } | null {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10))

/**
 * Read one inbound email's extraction as a reservation request, or null
 * when it isn't one we'd act on.
 *
 * Returns null — the card keeps today's Capture & Quote — when the
 * extraction is missing, under-confident, names no vehicle, or names one
 * the fleet doesn't answer to.
 *
 * QUANTITY counts how many times the client named that category, not
 * how many trucks they asked for — the extractor doesn't read counts,
 * and a guessed "2" is a guess against live capacity. The desk adjusts
 * in the modal, where it can see what's actually free.
 */
export function readEmailVehicleRequest(
  extracted: unknown,
  extractionConfidence: number | null | undefined,
  categories: MatchableCategory[],
  today: string,
): EmailVehicleRequest | null {
  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) return null
  const data = extracted as ExtractedData

  // The row's own column is the one the pipeline already gates on;
  // `confidence` inside the JSON is the same number and survives when a
  // caller only has the blob. Either being present and low is a stop.
  const confidence = typeof extractionConfidence === 'number' ? extractionConfidence
    : typeof data.confidence === 'number' ? data.confidence
    : 0
  if (confidence < MIN_EXTRACTION_CONFIDENCE) return null

  const requestedAs = (data.jobIntent?.vehicleType || '').trim()
  if (!requestedAs) return null

  const vehicles = readRequestedVehicles(requestedAs, categories)
  if (vehicles.length === 0) return null

  // Clients write "Sept 29" with no year and the model supplies one from
  // its own prior — the same wrong-year bug that put 2024 dates on live
  // quotes (see parsedDateYear). Roll it forward here too; a hold window
  // a year in the past would be worse than none.
  const start = isDay(data.jobIntent?.pickupDate)
    ? correctImpossibleYear(String(data.jobIntent?.pickupDate).slice(0, 10), today)
    : null
  const rawEnd = isDay(data.jobIntent?.returnDate)
    ? correctImpossibleYear(String(data.jobIntent?.returnDate).slice(0, 10), today)
    : null
  // An end before the start is a misread, not a window. Drop it to the
  // start rather than handing the modal a backwards range.
  const end = rawEnd && start && rawEnd < start ? start : rawEnd ?? start

  return {
    requestedAs,
    vehicles,
    start,
    end,
    jobName: data.jobIntent?.projectName?.trim() || null,
    companyName: data.company?.trim() || null,
    contact: (() => {
      const split = splitName(data.contact?.name)
      const email = data.contact?.email?.trim() || ''
      if (!split || !email) return null
      return { ...split, email, phone: data.contact?.phone?.trim() || null }
    })(),
    confidence,
  }
}
