/**
 * Does the certificate's NAMED INSURED match the production company we
 * papered the job under?
 *
 * Origin (Wes, 2026-08-25): a client uploaded a COI belonging to a
 * different production — the company on the certificate did not match the
 * production name on the job. Nothing in HQ noticed, and nothing told the
 * client. The rental agreement then goes out under the wrong entity, and
 * an insurance certificate that names someone else covers nothing if a
 * unit is damaged.
 *
 * The comparison is COMPUTED, never stored. `CoiCheck.namedInsured` holds
 * only the raw fact read off the document; the verdict is derived on every
 * read against the job's CURRENT company + production name, so correcting a
 * wrong production company clears the flag on both surfaces without
 * re-reviewing the certificate.
 *
 * Deliberately conservative: this decides what a human is TOLD, never what
 * is auto-approved or auto-rejected. A CLOSE verdict is shown, not acted on.
 */

export type InsuredMatchVerdict =
  /** Normalized names are the same entity. */
  | 'MATCH'
  /** Same entity by every practical reading (one is contained in the
   *  other, or the distinctive words line up) but not character-identical —
   *  worth showing, not worth alarming about. */
  | 'CLOSE'
  /** Different entities. The actionable state. */
  | 'MISMATCH'
  /** The job has no real production company yet ("TBD", "Unknown", ""),
   *  so there is nothing to compare against — but somebody still has to
   *  name the production before this job is papered. */
  | 'PLACEHOLDER'
  /** No named insured was extracted (AI review never ran, or the cert is
   *  unreadable). Not a finding — an absence. */
  | 'UNKNOWN'

export interface InsuredMatchResult {
  verdict: InsuredMatchVerdict
  /** True when a human needs to do something about it. */
  needsAttention: boolean
  namedInsured: string | null
  /** The candidate the verdict was reached against (best match, or the
   *  first real candidate when nothing matched). */
  comparedTo: string | null
  /** Every name we compared against, in the order tried. */
  candidates: string[]
  /** Staff-facing one-liner for the HQ job page / review modal. */
  message: string
  /** Client-safe one-liner for the portal. Never names another client's
   *  company back at a different client — it names only THEIR production
   *  and what is on their own certificate. */
  clientMessage: string
}

/** Names that mean "we haven't asked yet", not an actual company. */
const PLACEHOLDER_NAMES = new Set([
  'tbd',
  'tba',
  'tbd production',
  'tbd productions',
  'unknown',
  'unknown production',
  'n a',
  'na',
  'none',
  'new client',
  'new production',
  'test',
  'placeholder',
  'client',
  'production',
])

/** Legal-form suffixes that carry no identity. */
const ENTITY_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'lc',
  'llp',
  'lp',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'plc',
  'pllc',
  'gmbh',
  'sa',
  'sas',
  'bv',
  'pty',
])

/** Words too common in production-company names to prove identity on
 *  their own. "Acme Productions" vs "Zenith Productions" share a token
 *  but nothing that matters. */
const WEAK_TOKENS = new Set([
  'production',
  'productions',
  'prod',
  'prods',
  'film',
  'films',
  'media',
  'studio',
  'studios',
  'entertainment',
  'pictures',
  'picture',
  'group',
  'the',
  'a',
  'an',
  'of',
  'and',
  'for',
  'llc',
])

/** SirReel's own entity — a certificate naming US as the insured is our
 *  cert, not the client's, and covers nothing on their behalf. */
const SIRREEL_TOKENS = ['sirreel', 'sir reel']

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,''`"()\[\]/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(raw: string): string[] {
  return normalize(raw)
    .split(' ')
    .filter((t) => t && !ENTITY_SUFFIXES.has(t))
}

/** Identity key: normalized, entity suffixes dropped, words sorted so
 *  "Acme Films" and "Films, Acme" collapse together. */
function identityKey(raw: string): string {
  return tokens(raw).sort().join(' ')
}

/**
 * A certificate may carry more than one insured on one line —
 * "Acme Films LLC dba Acme Pictures", "Acme Films / Acme TV",
 * "Acme Films (Acme Pictures)". Any of them matching is a match.
 */
function splitInsuredParts(raw: string): string[] {
  const parts = raw
    .split(/\bd\/?b\/?a\b|\ba\/?k\/?a\b|\bf\/?k\/?a\b|\bdba\b|;|\||\s+\/\s+|\bformerly\b/i)
    .map((p) => p.trim())
    .filter(Boolean)
  return parts.length ? parts : [raw]
}

function isPlaceholder(name: string): boolean {
  const n = normalize(name)
  return !n || PLACEHOLDER_NAMES.has(n) || /^tbd\b/.test(n)
}

function isSirReel(name: string): boolean {
  const n = normalize(name)
  return SIRREEL_TOKENS.some((t) => n.includes(t))
}

/** Overlap of the DISTINCTIVE words, as a fraction of the smaller name. */
function distinctiveOverlap(a: string, b: string): number {
  const ta = new Set(tokens(a).filter((t) => !WEAK_TOKENS.has(t)))
  const tb = new Set(tokens(b).filter((t) => !WEAK_TOKENS.has(t)))
  if (!ta.size || !tb.size) return 0
  let hits = 0
  for (const t of ta) if (tb.has(t)) hits++
  return hits / Math.min(ta.size, tb.size)
}

/**
 * Compare the certificate's named insured against every name the job could
 * legitimately be papered under (the account company AND the production
 * name — clients routinely insure under one and book under the other).
 *
 * @param namedInsured what the certificate says, verbatim
 * @param candidates   company name, production/job name, … (falsy entries ok)
 */
export function evaluateInsuredMatch(
  namedInsured: string | null | undefined,
  candidates: Array<string | null | undefined>,
): InsuredMatchResult {
  const clean = (namedInsured || '').trim()
  const named = clean || null
  const real = candidates.map((c) => (c || '').trim()).filter(Boolean)
  const usable = real.filter((c) => !isPlaceholder(c))

  const base = { namedInsured: named, candidates: real }

  if (!named) {
    return {
      ...base,
      verdict: 'UNKNOWN',
      needsAttention: false,
      comparedTo: usable[0] ?? real[0] ?? null,
      message: 'No named insured read from this certificate — run the AI review to extract it.',
      clientMessage: '',
    }
  }

  // Our own certificate filed against a client job: it insures SirReel,
  // so it proves nothing about the client's coverage. Called out ahead of
  // the placeholder check — this is wrong regardless of the job's state.
  if (isSirReel(named) && !usable.some((c) => isSirReel(c))) {
    return {
      ...base,
      verdict: 'MISMATCH',
      needsAttention: true,
      comparedTo: usable[0] ?? null,
      message: `This certificate's named insured is SirReel (“${named}”) — it is our own certificate, not the client's coverage for this job.`,
      clientMessage:
        'The certificate we received names SirReel as the insured rather than your production. Please send the certificate issued to your production company.',
    }
  }

  if (!usable.length) {
    return {
      ...base,
      verdict: 'PLACEHOLDER',
      needsAttention: true,
      comparedTo: real[0] ?? null,
      message: `This job has no real production company yet${real[0] ? ` (“${real[0]}”)` : ''} — set it to “${named}” from the certificate, or to the correct entity, before the agreement goes out.`,
      clientMessage: '',
    }
  }

  const insuredParts = splitInsuredParts(named)

  let bestScore = 0
  let bestCandidate: string | null = null
  for (const cand of usable) {
    for (const part of insuredParts) {
      if (identityKey(part) === identityKey(cand)) {
        return {
          ...base,
          verdict: 'MATCH',
          needsAttention: false,
          comparedTo: cand,
          message: `Named insured “${named}” matches ${cand}.`,
          clientMessage: '',
        }
      }
      const pk = tokens(part).join(' ')
      const ck = tokens(cand).join(' ')
      // Containment: "Acme Films" vs "Acme Films Production Services".
      const contained = !!pk && !!ck && (pk.includes(ck) || ck.includes(pk))
      const overlap = distinctiveOverlap(part, cand)
      const score = contained ? Math.max(0.9, overlap) : overlap
      if (score > bestScore) {
        bestScore = score
        bestCandidate = cand
      }
    }
  }

  if (bestScore >= 0.6 && bestCandidate) {
    return {
      ...base,
      verdict: 'CLOSE',
      needsAttention: false,
      comparedTo: bestCandidate,
      message: `Named insured “${named}” looks like ${bestCandidate}, but the wording differs — worth a glance.`,
      clientMessage: '',
    }
  }

  const primary = bestCandidate ?? usable[0]
  return {
    ...base,
    verdict: 'MISMATCH',
    needsAttention: true,
    comparedTo: primary,
    message: `Named insured “${named}” does not match ${primary}. Confirm which entity is renting before the agreement goes out — if the production company is wrong, fix it and re-issue the agreement.`,
    clientMessage: `The certificate of insurance we received is issued to “${named}”, which doesn't match the production company on this job (${primary}). If the rental is under a different company, tell your SirReel rep so we can put the agreement under the right one.`,
  }
}

/** Badge tone per verdict, for the dark HQ surfaces. */
export const INSURED_MATCH_TONE: Record<InsuredMatchVerdict, string> = {
  MATCH: 'bg-emerald-500/10 text-emerald-300',
  CLOSE: 'bg-sky-500/10 text-sky-300',
  MISMATCH: 'bg-rose-500/15 text-rose-300',
  PLACEHOLDER: 'bg-amber-500/15 text-amber-300',
  UNKNOWN: 'bg-zinc-700/60 text-zinc-300',
}

/**
 * Light-surface twin of INSURED_MATCH_TONE. The jobs detail page went light
 * on 2026-09-01; CoiReviewModal is still a dark overlay and keeps the map
 * above. Same verdicts, same order — change them together.
 */
export const INSURED_MATCH_TONE_LIGHT: Record<InsuredMatchVerdict, string> = {
  MATCH: 'bg-emerald-50 text-emerald-700',
  CLOSE: 'bg-sky-50 text-sky-700',
  MISMATCH: 'bg-rose-50 text-rose-700',
  PLACEHOLDER: 'bg-amber-50 text-amber-800',
  UNKNOWN: 'bg-zinc-100 text-zinc-700',
}

export const INSURED_MATCH_LABEL: Record<InsuredMatchVerdict, string> = {
  MATCH: 'Name matches',
  CLOSE: 'Name close',
  MISMATCH: 'Name mismatch',
  PLACEHOLDER: 'No production company',
  UNKNOWN: 'Name not read',
}
