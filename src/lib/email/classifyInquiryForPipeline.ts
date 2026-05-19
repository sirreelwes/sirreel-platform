/**
 * Pipeline-section inclusion classifier for inbound emails.
 *
 * Context: every inbound that lands in `EmailMessage` with category
 * BOOKING_INQUIRY/RENTAL_REQUEST is a *candidate* for the
 * Pipeline → Inquiries view. But Cognito Forms sends paperwork
 * (rental agreements, COIs, damage reports) from the same address as
 * real leads, and the broad keyword-based quickTriage at ingestion
 * tags them all the same. This refines that decision at query time.
 *
 * Decision waterfall (matches the May 2026 spec):
 *
 *   1. AI extraction primary — if the per-message extractor ran with
 *      sufficient confidence (>= 0.5), trust `messageNature`:
 *        - 'inquiry'      → include (real lead)
 *        - 'reply'        → classify by parent (Re: handling below)
 *        - 'rejection'    → exclude (kind: 'rejection')
 *        - 'confirmation' → exclude (kind: 'confirmation')
 *        - 'question'     → include (treat as lead — client asking
 *                                    for info on a fresh thread)
 *        - 'other'        → fall through to subject pattern
 *
 *   2. Subject pattern fallback — strip leading "Re:/Fwd:" tokens
 *      then match against the Cognito form prefixes:
 *        - "NEW INQUIRY:" / "Booking Inquiry" → include (real lead)
 *        - "Rental Agreement |"               → exclude (paperwork)
 *        - "Annual Rental Agreement |"        → exclude (paperwork)
 *        - "Vehicle Damage Report |"          → exclude (operational)
 *        - "Certificate of Insurance |"       → exclude (coi)
 *        - anything else                      → include (default —
 *          better to surface a borderline email than silently hide it)
 *
 *   3. Re: handling — replies are classified by the *parent thread's*
 *      classification. The current row's subject after stripping "Re:"
 *      is the parent's subject (Cognito doesn't munge subject lines on
 *      reply), so a "Re: Annual Rental Agreement | …" is detected as
 *      paperwork via the same subject pattern. No separate parent
 *      lookup needed in the common case.
 *
 * Why we don't update stored `category` instead: the category column
 * is also consumed by the dashboard widget and the inbox bell; tightening
 * it would shrink those views too. Refining at the pipeline-query layer
 * keeps the broad signal intact for other consumers.
 */

import type { ExtractedMessage } from '@/lib/ai/messageExtractor'
import { inferFormTypeFromSubject } from './inferFormType'

/**
 * Why an email was included or excluded. Stable strings — the UI can
 * group hidden items by this and the API can log it for debugging
 * false-negatives.
 */
export type InquiryClassification =
  | 'inquiry'
  | 'paperwork' // JOB_AGREEMENT + ANNUAL_AGREEMENT — rental agreements
  | 'damage_report'
  | 'coi'
  | 'rejection'
  | 'confirmation'
  | 'other'

export interface InquiryClassifyInput {
  subject: string | null
  inReplyTo: string | null
  extractedData: unknown // EmailMessage.extractedData JSON column
  extractionConfidence: number | null
}

export interface InquiryClassifyResult {
  include: boolean
  classification: InquiryClassification
  reason: string
}

const REPLY_PREFIX = /^\s*(re|fwd|fw)\s*:\s*/i
const AI_CONFIDENCE_THRESHOLD = 0.5

function stripReplyPrefixes(subject: string | null | undefined): string {
  if (!subject) return ''
  let s = subject
  // Strip up to 5 nested "Re: Re: Re: …" levels; arbitrary safety cap.
  for (let i = 0; i < 5; i++) {
    if (!REPLY_PREFIX.test(s)) break
    s = s.replace(REPLY_PREFIX, '')
  }
  return s
}

function readMessageNature(extractedData: unknown): ExtractedMessage['messageNature'] | null {
  if (!extractedData || typeof extractedData !== 'object') return null
  const nature = (extractedData as { messageNature?: unknown }).messageNature
  if (
    nature === 'inquiry' ||
    nature === 'reply' ||
    nature === 'confirmation' ||
    nature === 'question' ||
    nature === 'rejection' ||
    nature === 'other'
  ) {
    return nature
  }
  return null
}

/**
 * Classify a single inbound email for inclusion in the Pipeline →
 * Inquiries view. Pure function; no I/O.
 */
export function classifyInquiryForPipeline(input: InquiryClassifyInput): InquiryClassifyResult {
  const subject = input.subject ?? ''
  const stripped = stripReplyPrefixes(subject)
  const aiNature = readMessageNature(input.extractedData)
  const confidence = input.extractionConfidence ?? 0
  const aiTrustworthy = aiNature !== null && confidence >= AI_CONFIDENCE_THRESHOLD

  // ── 1. AI primary, when trustworthy ───────────────────────────────
  if (aiTrustworthy) {
    if (aiNature === 'inquiry' || aiNature === 'question') {
      // Even when AI says "inquiry", a paperwork subject should win —
      // Cognito's rental-agreement form bodies sometimes look like a
      // lead to the extractor (free-text vehicle description, dates,
      // etc.). Subject prefix is the reliable signal for Cognito.
      const paperwork = classifyBySubject(stripped, input.inReplyTo)
      if (!paperwork.include) return paperwork
      return {
        include: true,
        classification: 'inquiry',
        reason: `AI messageNature=${aiNature} @ ${confidence.toFixed(2)}`,
      }
    }
    if (aiNature === 'rejection') {
      return { include: false, classification: 'rejection', reason: `AI messageNature=rejection @ ${confidence.toFixed(2)}` }
    }
    if (aiNature === 'confirmation') {
      return {
        include: false,
        classification: 'confirmation',
        reason: `AI messageNature=confirmation @ ${confidence.toFixed(2)}`,
      }
    }
    if (aiNature === 'reply') {
      // Reply → classify by subject (which after stripping "Re:" is the
      // parent's subject — no separate parent lookup needed for Cognito).
      return classifyBySubject(stripped, input.inReplyTo, `AI says reply @ ${confidence.toFixed(2)}; `)
    }
    // 'other' falls through to subject heuristics.
  }

  // ── 2. Subject pattern fallback ──────────────────────────────────
  return classifyBySubject(stripped, input.inReplyTo)
}

function classifyBySubject(
  strippedSubject: string,
  inReplyTo: string | null,
  reasonPrefix = '',
): InquiryClassifyResult {
  const formType = inferFormTypeFromSubject(strippedSubject)
  switch (formType) {
    case 'JOB_AGREEMENT':
      return {
        include: false,
        classification: 'paperwork',
        reason: `${reasonPrefix}subject prefix matches Rental Agreement`,
      }
    case 'ANNUAL_AGREEMENT':
      return {
        include: false,
        classification: 'paperwork',
        reason: `${reasonPrefix}subject prefix matches Annual Rental Agreement`,
      }
    case 'DAMAGE_REPORT':
      return {
        include: false,
        classification: 'damage_report',
        reason: `${reasonPrefix}subject prefix matches Vehicle Damage Report`,
      }
    case 'COI':
      return {
        include: false,
        classification: 'coi',
        reason: `${reasonPrefix}subject prefix matches Certificate of Insurance`,
      }
    case 'BOOKING_INQUIRY':
      return {
        include: true,
        classification: 'inquiry',
        reason: `${reasonPrefix}subject prefix matches NEW INQUIRY / Booking Inquiry`,
      }
    case null:
    default: {
      // No subject signal. Default to include — better to surface a
      // borderline lead than silently hide it. The reason field tells
      // future-you why this one slipped through if it turns out wrong.
      const isReply = !!inReplyTo && inReplyTo.trim() !== ''
      return {
        include: true,
        classification: 'other',
        reason: `${reasonPrefix}no AI signal and no subject prefix match (${isReply ? 'reply' : 'thread start'}) — included by default`,
      }
    }
  }
}
