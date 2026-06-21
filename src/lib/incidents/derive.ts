/**
 * Derived facets for the Incidents decision-first surface — Phase 2.
 *
 * Pure functions, no Prisma imports. Same module powers the server
 * (api/incidents enrichment) and the client (ClaimMailTriage's
 * IncidentGroupCard severity chip). Anything heuristic here is
 * deliberately marked "derived" in the UI so Phase 3's stored +
 * overridable severity / posture / next-action can supersede without
 * surprise.
 *
 * Two-axis intent:
 *   - severity    → "do this NOW vs. this is normal" (drives sort)
 *   - posture     → "where on the recovery ladder are we?" (drives stepper)
 *   - nextAction  → "what should the rep do next?" (drives the suggestion line)
 */

export type DerivedSeverity = 'LITIGATION' | 'ROUTINE'

export type RecoveryPosture =
  | 'carrier_not_started'
  | 'carrier_live'
  | 'billing_renter'
  | 'closed'

export type IncidentStatusLite =
  | 'OPEN'
  | 'CLAIM_FILED'
  | 'BILLED_RENTER'
  | 'RESOLVED'
  | 'WRITTEN_OFF'

// ─── Severity ──────────────────────────────────────────────────────

// Inbound-mail heuristics for "this incident has a legal posture."
// Keep these BROAD on purpose — false-positives just mark something
// LITIGATION which a rep can override in Phase 3 once severity is
// stored. The cost of missing a real lawsuit signal is high; the
// cost of an over-flagged routine fender-bender is one click.
const LAW_FIRM_SENDER_PATTERNS: RegExp[] = [
  /@[^@]*\blaw\b/i,             // *law.com, *law-foo.com, *.lawyer.law
  /@[^@]*\blawfirm\b/i,
  /@[^@]*\blegal\b/i,
  /@[^@]*\battorney/i,
  /@[^@]*\blawyer/i,
  /@[^@]*\bcounsel\b/i,
  /@[^@]*\besquire?\b/i,
  /@[^@]*\bllp\.com$/i,
  /\.law$/i,                    // bare .law TLD
]

// Phrase signals in the Sonnet parse text (lossDescription, statusGuess).
// Word-boundary-anchored where it matters; substring-anchored for the
// multi-word ones ("demand letter", "cease and desist").
const LITIGATION_PHRASES: (string | RegExp)[] = [
  /\blawsuit\b/i,
  /\blitigation\b/i,
  /\bsuit\b/i,
  /\bsummons\b/i,
  /\bsubpoena\b/i,
  /\bplaintiff\b/i,
  /\bdefendant\b/i,
  /\btort\b/i,
  /\bdemand\s+letter\b/i,
  /\bcease\s+and\s+desist\b/i,
  /\bcomplaint\s+filed\b/i,
  /\bcourt\s+(case|filing|date|appearance)\b/i,
  /\bnotice\s+of\s+claim\b/i,
  /\battorney\b/i,
  /\bcounsel\b/i,
  /\besq\b/i,
]

export interface ClaimMailSeveritySignal {
  parse: unknown
  emailMessage: { fromAddress: string }
}

function senderLooksLikeLawFirm(fromAddress: string | null | undefined): boolean {
  if (!fromAddress) return false
  return LAW_FIRM_SENDER_PATTERNS.some((re) => re.test(fromAddress))
}

function parseHasLitigationPhrase(parse: unknown): boolean {
  if (!parse || typeof parse !== 'object') return false
  // Sonnet ParsedClaim shape — only the free-text fields are checked.
  // Add new fields here if the parse schema grows; defensive against
  // shape drift since `parse` is Prisma's Json column.
  const p = parse as Record<string, unknown>
  const blob = [
    p.lossDescription,
    p.statusGuess,
  ]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
  if (!blob) return false
  return LITIGATION_PHRASES.some((m) =>
    m instanceof RegExp ? m.test(blob) : blob.toLowerCase().includes(m.toLowerCase()),
  )
}

/**
 * LITIGATION if ANY linked ClaimMail row has either a law-firm-looking
 * sender domain or a litigation phrase in its parse text. Else ROUTINE.
 */
export function computeDerivedSeverity(
  mail: ReadonlyArray<ClaimMailSeveritySignal>,
): DerivedSeverity {
  for (const m of mail) {
    if (senderLooksLikeLawFirm(m.emailMessage?.fromAddress)) return 'LITIGATION'
    if (parseHasLitigationPhrase(m.parse)) return 'LITIGATION'
  }
  return 'ROUTINE'
}

// ─── Recovery posture ──────────────────────────────────────────────

/**
 * Three-step recovery ladder, derived. Evaluation order picks the
 * HIGHEST-reached step so e.g. status=CLAIM_FILED + damageItems>0
 * collapses to 'billing_renter' (the further-along step).
 *
 *   Closed wins over everything (terminal).
 *   billing_renter wins over carrier_live (further along the ladder).
 *   carrier_live wins over carrier_not_started.
 */
export function computeRecoveryPosture(
  status: IncidentStatusLite,
  claimsCount: number,
  damageItemsCount: number,
): RecoveryPosture {
  if (status === 'RESOLVED' || status === 'WRITTEN_OFF') return 'closed'
  if (status === 'BILLED_RENTER' || damageItemsCount > 0) return 'billing_renter'
  if (status === 'CLAIM_FILED' || claimsCount > 0) return 'carrier_live'
  return 'carrier_not_started'
}

// ─── Suggested next action ─────────────────────────────────────────

export interface NextActionContext {
  status: IncidentStatusLite
  claimsCount: number
  damageItemsCount: number
  derivedSeverity: DerivedSeverity
  /** True when at least one ClaimMail parse contains a carrierClaimNumber,
   *  which means the renter / their insurer has filed against us but we
   *  haven't onboarded the InsuranceClaim row yet. */
  parseHasCarrierClaimNumber: boolean
}

/**
 * Heuristic, single-line suggestion. The UI will render this with a
 * "Suggested:" prefix so it's clearly advisory, not directive.
 *
 * Precedence (top to bottom — first match wins):
 *   1. closed states → confirmatory action
 *   2. LITIGATION + no carrier claim → tender + counsel
 *   3. Parse carries a carrier claim # but we have no InsuranceClaim → onboard it
 *   4. CLAIM_FILED + carrier claim live → waiting on adjuster
 *   5. BILLED_RENTER + damage items → waiting on renter
 *   6. OPEN + nothing else → start triage
 */
export function computeSuggestedNextAction(ctx: NextActionContext): string {
  if (ctx.status === 'RESOLVED') return 'Resolved — confirm + archive'
  if (ctx.status === 'WRITTEN_OFF') return 'Absorbed — record cost in ledger'
  if (ctx.derivedSeverity === 'LITIGATION' && ctx.claimsCount === 0) {
    return 'Tender to insurer + engage counsel'
  }
  if (ctx.parseHasCarrierClaimNumber && ctx.claimsCount === 0) {
    return 'Upgrade to claim — carrier # in inbound mail'
  }
  if (ctx.status === 'CLAIM_FILED' || ctx.claimsCount > 0) {
    return 'Awaiting adjuster — chase if quiet > 7d'
  }
  if (ctx.status === 'BILLED_RENTER' || ctx.damageItemsCount > 0) {
    return 'Awaiting renter payment — invoice + follow up'
  }
  return 'Start carrier claim or decide path'
}

// ─── Convenience: detect a carrier claim # in parse JSON ──────────

export function parseCarriesCarrierClaimNumber(parse: unknown): boolean {
  if (!parse || typeof parse !== 'object') return false
  const p = parse as Record<string, unknown>
  const v = p.carrierClaimNumber
  return typeof v === 'string' && v.trim().length > 0
}
