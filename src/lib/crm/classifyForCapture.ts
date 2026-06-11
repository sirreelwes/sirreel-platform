/**
 * Verdict classifier for the CRM auto-capture pipeline.
 *
 * Sits ON TOP of the Haiku extraction layer (EmailMessage.extractedData).
 * Decision tree, in order:
 *
 *   1. Hard skips — automated senders, @sirreel.com authorship, cold
 *      solicitation keywords / Haiku's solicitation verdict. ANY ONE
 *      → SKIPPED with reason.
 *
 *   2. Production-legitimacy signals — score the message against the
 *      four signals in the STEP 2 spec. ONE match → AUTO_CAPTURED:
 *        a. Production role title in signature
 *        b. Production company / show / project named
 *        c. Sender domain matches existing CRM Company (domain match
 *           passed in by caller)
 *        d. Rental intent (vehicleType / equipment / messageNature='inquiry')
 *      Bias is aggressive — even thin rental intent from a freemail
 *      domain counts.
 *
 *   3. Genuinely ambiguous — Haiku says inquiry/question but no
 *      stronger signal. → NEEDS_REVIEW. Caller may upgrade to a
 *      Sonnet tiebreaker (see verifyWithSonnet) before storing.
 *
 *   4. Anything else → SKIPPED (stored for audit, muted in UI).
 *
 * Side-effect-free: returns a verdict + parsed payload + signals; the
 * caller writes the InquiryCapture row and (on AUTO_CAPTURED) the
 * Person/enrichment.
 */

import {
  HARD_SKIP_SENDER_PATTERNS,
  COLD_SOLICITATION_KEYWORDS,
  PRODUCTION_TITLE_TOKENS,
  KNOWN_VENDOR_DOMAINS,
  OWN_COMPANY_PATTERN,
  SIRREEL_DOMAIN,
} from './captureConstants'
import type { ExtractedMessage } from '@/lib/ai/messageExtractor'

export type CaptureVerdictTag = 'AUTO_CAPTURED' | 'NEEDS_REVIEW' | 'SKIPPED'

export interface ClassifyInput {
  inbox: string
  fromAddress: string
  subject: string | null
  bodySnippet: string | null
  extracted: ExtractedMessage | null
  /** Caller-supplied: does sender domain match an existing CRM Company? */
  domainMatchedCompanyId: string | null
}

export interface ParsedPayload {
  name: string | null
  email: string | null
  phone: string | null
  title: string | null
  companyString: string | null
  project: string | null
}

export interface VerdictResult {
  verdict: CaptureVerdictTag
  reason: string
  signals: string[]
  parsed: ParsedPayload
}

function bareEmail(fromAddress: string): string {
  const m = fromAddress.match(/<([^>]+)>/)
  return (m ? m[1] : fromAddress).trim().toLowerCase()
}

function senderLocalPart(fromAddress: string): string {
  const bare = bareEmail(fromAddress)
  const at = bare.indexOf('@')
  return at < 0 ? bare : bare.slice(0, at)
}

function senderDomain(fromAddress: string): string {
  const bare = bareEmail(fromAddress)
  const at = bare.indexOf('@')
  return at < 0 ? '' : bare.slice(at + 1)
}

function containsAny(haystack: string, needles: readonly string[]): string | null {
  const h = haystack.toLowerCase()
  for (const n of needles) {
    if (h.includes(n)) return n
  }
  return null
}

function buildParsedPayload(input: ClassifyInput): ParsedPayload {
  const ex = input.extracted
  const from = bareEmail(input.fromAddress)
  const fromName = (() => {
    const m = input.fromAddress.match(/^([^<]+)</)
    return m ? m[1].trim().replace(/^"|"$/g, '').trim() || null : null
  })()
  return {
    name: ex?.contact.name ?? fromName,
    email: ex?.contact.email ?? from,
    phone: ex?.contact.phone ?? null,
    title: ex?.contact.title ?? null,
    companyString: ex?.company ?? null,
    project: ex?.jobIntent.projectName ?? null,
  }
}

export function classifyForCapture(input: ClassifyInput): VerdictResult {
  const parsed = buildParsedPayload(input)
  const localPart = senderLocalPart(input.fromAddress)
  const domain = senderDomain(input.fromAddress)

  // ── HARD SKIPS ───────────────────────────────────────────────────
  const hardSkipPattern = HARD_SKIP_SENDER_PATTERNS.find((p) => localPart.includes(p))
  if (hardSkipPattern) {
    return {
      verdict: 'SKIPPED',
      reason: `automated sender (matched "${hardSkipPattern}" in localpart)`,
      signals: [],
      parsed,
    }
  }
  if (domain === SIRREEL_DOMAIN || domain.endsWith(`.${SIRREEL_DOMAIN}`)) {
    return {
      verdict: 'SKIPPED',
      reason: 'sender is @sirreel.com (internal mail / staff forward)',
      signals: [],
      parsed,
    }
  }
  // Known vendor / service-provider domains — our insurance broker,
  // CPA, etc. They show up in these inboxes constantly and the AI
  // signal can't reliably distinguish them from production contacts
  // when they reference a company name. Hard-skip before legitimacy.
  if (KNOWN_VENDOR_DOMAINS.has(domain)) {
    return {
      verdict: 'SKIPPED',
      reason: `known vendor / service-provider domain (${domain})`,
      signals: [],
      parsed,
    }
  }
  // Haiku parsed our own company name into parsedCompanyString — almost
  // always a staff-signature leak or thread-reply mention, never a real
  // production lead.
  if (parsed.companyString && OWN_COMPANY_PATTERN.test(parsed.companyString)) {
    return {
      verdict: 'SKIPPED',
      reason: `parsed company is SirReel itself (self-mention leak: "${parsed.companyString}")`,
      signals: [],
      parsed,
    }
  }
  if (input.extracted?.messageNature === 'solicitation') {
    return {
      verdict: 'SKIPPED',
      reason: 'Haiku classified as cold solicitation',
      signals: [],
      parsed,
    }
  }
  if (input.extracted?.messageNature === 'vendor') {
    return {
      verdict: 'SKIPPED',
      reason: 'Haiku classified as vendor selling to SirReel',
      signals: [],
      parsed,
    }
  }
  {
    const haystack = `${input.subject ?? ''}\n${(input.bodySnippet ?? '').slice(0, 600)}`
    const kw = containsAny(haystack, COLD_SOLICITATION_KEYWORDS)
    if (kw && !input.extracted) {
      // Belt-and-suspenders for messages without Haiku extraction.
      // When extraction exists we trust Haiku's verdict above.
      return {
        verdict: 'SKIPPED',
        reason: `cold-solicitation keyword "${kw}" in subject/preview`,
        signals: [],
        parsed,
      }
    }
  }

  // ── PRODUCTION-LEGITIMACY SIGNALS ────────────────────────────────
  const signals: string[] = []

  // (a) Production role title in signature
  if (parsed.title) {
    const titleHit = PRODUCTION_TITLE_TOKENS.find((t) => parsed.title!.toLowerCase().includes(t))
    if (titleHit) signals.push(`production_title:${titleHit}`)
  }

  // (b) Production company / show / project named
  if (parsed.companyString && parsed.companyString.trim().length > 1) {
    signals.push('company_named')
  }
  if (parsed.project && parsed.project.trim().length > 1) {
    signals.push('project_named')
  }

  // (c) Sender domain matches existing CRM company
  if (input.domainMatchedCompanyId) {
    signals.push('domain_matches_crm_company')
  }

  // (d) Rental intent toward our services
  const intent = input.extracted?.jobIntent
  if (intent?.vehicleType && intent.vehicleType.trim()) signals.push('vehicle_type_named')
  if (intent && intent.equipment.length > 0) signals.push('equipment_named')
  if (intent?.pickupDate || intent?.returnDate || intent?.duration) signals.push('dates_named')
  if (intent?.location && intent.location.trim()) signals.push('location_named')
  if (input.extracted?.messageNature === 'inquiry') signals.push('haiku_inquiry')

  if (signals.length > 0) {
    return {
      verdict: 'AUTO_CAPTURED',
      reason: `production-legitimacy signals: ${signals.join(', ')}`,
      signals,
      parsed,
    }
  }

  // ── AMBIGUOUS LANE ───────────────────────────────────────────────
  // Haiku said question / reply with NO strong signal. Likely a thread
  // continuation we missed context on. Surface to NEEDS_REVIEW so the
  // rep can decide whether to capture.
  if (
    input.extracted?.messageNature === 'question' ||
    input.extracted?.messageNature === 'reply'
  ) {
    return {
      verdict: 'NEEDS_REVIEW',
      reason: `Haiku messageNature=${input.extracted.messageNature} with no production signal — human eyeball`,
      signals,
      parsed,
    }
  }

  // ── DEFAULT: SKIPPED (no signal) ─────────────────────────────────
  return {
    verdict: 'SKIPPED',
    reason: input.extracted
      ? `no production signal (Haiku messageNature=${input.extracted.messageNature})`
      : 'no Haiku extraction available — defaulting to SKIPPED until backfill',
    signals,
    parsed,
  }
}
