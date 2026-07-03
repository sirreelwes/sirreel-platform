/**
 * AI document classifier for uploaded ClaimDocuments.
 *
 * Mirrors the COI-check pattern (src/app/api/tools/coi-check/route.ts):
 * Sonnet with native PDF / image input, strict JSON output, defensive
 * fallback so a failed classify never blocks an upload.
 *
 * Behavior contract:
 *   - Never throws past the caller. Sonnet errors, JSON parse failures,
 *     shape mismatches all collapse to { docType: 'OTHER', confidence:
 *     0, reasoning: '(classification failed)' }.
 *   - Always returns a typeSource hint the caller stamps onto the row.
 *     Heuristic decisions (HEIC by extension → PHOTO, .eml → CORRESPONDENCE)
 *     return AI_SUGGESTED so the UI still surfaces a "review this" affordance
 *     — the user can confirm or override.
 *   - PDF + image input goes to Sonnet directly. Other content types
 *     skip the LLM and fall back to OTHER (or a filename heuristic
 *     where one exists).
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ClaimDocType } from '@prisma/client'
import { PARSING_MODEL } from '@/lib/ai/models'

const MODEL = PARSING_MODEL
const MAX_TOKENS = 600

// Vocabulary the classifier picks from. Intentionally narrower than the
// full ClaimDocType enum — the legacy CHECKOUT_PHOTO / RETURN_PHOTO /
// DEMAND_LETTER / COUNTER_LETTER / REPAIR_INVOICE / SETTLEMENT values
// stay reachable for hand-set re-classification (STEP 4 UI), but the
// AI never proposes them. Keeps suggestions in the clean new vocabulary
// so the picker stays scannable.
const CLASSIFIER_TYPES: ClaimDocType[] = [
  'PHOTO',
  'DAMAGE_INVOICE',
  'REPAIR_ESTIMATE',
  'COI',
  'RENTAL_AGREEMENT',
  'POLICE_REPORT',
  'CORRESPONDENCE',
  'OTHER',
]
const VALID_SET = new Set<string>(CLASSIFIER_TYPES)

export interface ClassificationResult {
  docType: ClaimDocType
  confidence: number
  reasoning: string | null
}

const PROMPT = `You are classifying a document attached to an insurance claim filed by SirReel Studio Services (a rental house for production vehicles). The document was either uploaded directly by a SirReel rep or arrived as an email attachment from a carrier/adjuster.

Pick the BEST single category from this list and return STRICT JSON:

{
  "docType": "PHOTO" | "DAMAGE_INVOICE" | "REPAIR_ESTIMATE" | "COI" | "RENTAL_AGREEMENT" | "POLICE_REPORT" | "CORRESPONDENCE" | "OTHER",
  "confidence": number,
  "reasoning": string
}

Category guide:
- PHOTO            — any photograph (damage photos, vehicle inspection shots, scene photos). If the file IS an image and it's not a screenshot of a document, it's almost always a PHOTO.
- DAMAGE_INVOICE   — an invoice billing for damage to the rented unit. SirReel-issued or third-party. Distinct from REPAIR_ESTIMATE (which is a proposed cost) and from REPAIR_INVOICE-from-a-shop in the legacy vocabulary.
- REPAIR_ESTIMATE  — a quoted, not-yet-billed estimate of repair cost. Often from a body shop / mechanic.
- COI              — Certificate of Insurance. Standard ACORD 25 / 27 format. Lists policy limits + holder + additional insured.
- RENTAL_AGREEMENT — the rental contract / agreement between SirReel and the renter (e.g. "Annual Rental Agreement", "Job Agreement").
- POLICE_REPORT    — official law-enforcement report on the incident.
- CORRESPONDENCE   — email chain, letter, message thread, signed correspondence between SirReel and the carrier/adjuster/renter. Default for text-heavy non-form documents.
- OTHER            — none of the above clearly applies.

confidence: 0..1. Reflect how complete the document evidence is. <0.5 means "could be either of two categories; rep should verify".

reasoning: ONE short sentence stating the strongest signal you used.

Critical rules:
- Output ONLY the JSON. No code fences, no preamble.
- When unsure between PHOTO and a paper category, prefer PHOTO if the image content is clearly photographic (not a scanned printed document).
`

const FALLBACK: ClassificationResult = {
  docType: 'OTHER',
  confidence: 0,
  reasoning: '(classification failed)',
}

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

let warnedKeyMissing = false
function warnKeyMissing(): void {
  if (warnedKeyMissing) return
  warnedKeyMissing = true
  console.error('[classify-claim-document] ANTHROPIC_API_KEY missing — every classify returns FALLBACK.')
}

function coerce(raw: unknown): ClassificationResult {
  if (!raw || typeof raw !== 'object') return FALLBACK
  const r = raw as Record<string, unknown>
  const dt = typeof r.docType === 'string' && VALID_SET.has(r.docType) ? (r.docType as ClaimDocType) : 'OTHER'
  let conf = typeof r.confidence === 'number' ? r.confidence : Number(r.confidence)
  if (!Number.isFinite(conf)) conf = 0
  conf = Math.max(0, Math.min(1, conf))
  const reasoning = typeof r.reasoning === 'string' && r.reasoning.trim() ? r.reasoning.trim().slice(0, 500) : null
  return { docType: dt, confidence: conf, reasoning }
}

// Filename + content-type heuristics that bypass the LLM. The classifier
// still tags these AI_SUGGESTED so the UI surfaces a review chip — the
// reviewer can override if the filename was misleading.
function heuristicClassify(filename: string, contentType: string): ClassificationResult | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.eml') || contentType === 'message/rfc822') {
    return { docType: 'CORRESPONDENCE', confidence: 0.7, reasoning: 'Filename ends in .eml (email message).' }
  }
  if (lower.endsWith('.heic') || lower.endsWith('.heif') || contentType === 'image/heic' || contentType === 'image/heif') {
    return { docType: 'PHOTO', confidence: 0.7, reasoning: 'HEIC/HEIF image (camera photo).' }
  }
  return null
}

export async function classifyClaimDocument(args: {
  filename: string
  contentType: string
  fileBuffer: Buffer
}): Promise<ClassificationResult> {
  const { filename, contentType, fileBuffer } = args

  try {
    // Heuristic first — avoids burning a Sonnet call on cases the
    // extension alone makes obvious.
    const h = heuristicClassify(filename, contentType)
    if (h) return h

    // Skip LLM if we have no key (dev mode / preview env without secret).
    if (!process.env.ANTHROPIC_API_KEY) {
      warnKeyMissing()
      return FALLBACK
    }

    const isPdf = contentType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')
    const isPng = contentType === 'image/png' || filename.toLowerCase().endsWith('.png')
    const isJpeg = contentType === 'image/jpeg' || /\.(jpe?g)$/i.test(filename)

    if (!isPdf && !isPng && !isJpeg) {
      // Unsupported by Sonnet's document/image inputs. Fall back rather
      // than emitting bad input.
      return {
        docType: 'OTHER',
        confidence: 0,
        reasoning: `Content type "${contentType}" not classifier-supported; manual pick recommended.`,
      }
    }

    const base64 = fileBuffer.toString('base64')
    const content: Anthropic.Messages.ContentBlockParam[] = isPdf
      ? [
          { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } },
          { type: 'text' as const, text: PROMPT + `\n\nFilename: ${filename}` },
        ]
      : [
          { type: 'image' as const, source: { type: 'base64' as const, media_type: (isPng ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg', data: base64 } },
          { type: 'text' as const, text: PROMPT + `\n\nFilename: ${filename}` },
        ]

    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content }],
    })
    const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
    const stripped = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/, '').trim()
    return coerce(JSON.parse(stripped))
  } catch (err) {
    console.error('[classify-claim-document] failed for', filename, err instanceof Error ? err.message : err)
    return FALLBACK
  }
}
