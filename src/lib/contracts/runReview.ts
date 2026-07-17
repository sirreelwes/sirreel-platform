import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'fs/promises'
import path from 'path'
import {
  CANONICAL_CLAUSES,
  FLEET_AGREEMENT,
  LCDW_ADDENDUM,
} from '@/lib/contracts/contractClauses'
import {
  buildContractReviewSystemPrompt,
  detectThirdPartyOnlyIndemnity,
  formatSecondRoundClausesForUserPrompt,
} from '@/lib/contracts/reviewPrompt'
import { REVIEW_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'
import {
  buildAnnotationManifest,
  clauseMatches,
  extractPdfTextLayer,
  formatManifestForPrompt,
  manifestHasMarkup,
  normalizeForMatch,
  renderPdfPageImages,
  type MarkupManifest,
} from '@/lib/contracts/annotationManifest'

const STANDARD_AGREEMENT_PATH = path.join(
  process.cwd(),
  'public',
  'contracts',
  'sirreel-rental-agreement.pdf'
)

// Native fetch (undici) instead of the SDK 0.39 node-fetch shim — the
// shim read-ETIMEDOUTs on this route's multi-MB base64 PDF uploads
// (reproduced locally; native fetch completes the same request in
// seconds). Node ≥18 everywhere we run, so globalThis.fetch always exists.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: globalThis.fetch as any })

export interface RunReviewInput {
  /**
   * The client's uploaded PDF. The review is CANONICALLY MULTIMODAL:
   * from this buffer the pipeline ALWAYS derives all three inputs —
   * TEXT LAYER (pdfjs extraction), ANNOTATION GROUND TRUTH (the
   * markup manifest), and VISUAL GROUND TRUTH (every page rasterized
   * to an image). If ANY of the three fails to build, the review
   * fails loudly — never silently degrades to a subset.
   */
  uploadedPdf: Buffer
  companyName?: string
  secondRoundClauses?: string[]
}

export type RunReviewResult =
  | { ok: true; review: any; rawText: string; annotationManifest: MarkupManifest }
  | { ok: false; error: string; rawOutput?: string; status: number }

const THIRD_PARTY_AUTO_FLAG_REASON =
  'Auto-flagged: counter language contains third-party-only indemnity phrasing. Per playbook §1, third-party-only indemnity is a Non-Negotiable Hard Limit and is never accepted or offered as a fallback. Counter rewritten to broad indemnity Preferred language.'

function baselineClauseText(): string {
  return (
    CANONICAL_CLAUSES.map((c) => `[${c.ref}] ${c.title}\n${c.body}`).join('\n\n') +
    `\n\n[Fleet Agreement] ${FLEET_AGREEMENT.title}\n${FLEET_AGREEMENT.intro}\n${FLEET_AGREEMENT.fuelPolicy}` +
    `\n\n[LCDW] ${LCDW_ADDENDUM.title}\n${LCDW_ADDENDUM.rate}\n${LCDW_ADDENDUM.scope}\n${LCDW_ADDENDUM.note}`
  )
}

export async function runContractReviewAi(input: RunReviewInput): Promise<RunReviewResult> {
  const { uploadedPdf, companyName, secondRoundClauses } = input

  // ── The three canonical inputs. Each failure is FATAL and named —
  //    a review must never silently run on a subset (origin: review
  //    fd97acb0, where the manifest pre-pass threw in prod, the catch
  //    swallowed it, and a flattened counter-PDF was declared
  //    "identical to baseline, 0 changes"). ──
  let annotationManifest: MarkupManifest
  let textLayerPages: string[]
  let pageImages: Array<{ page: number; jpegBase64: string }>
  try {
    annotationManifest = await buildAnnotationManifest(uploadedPdf)
  } catch (err) {
    console.error('[contract-review] FATAL: annotation manifest pre-pass failed:', err)
    return { ok: false, status: 500, error: `Annotation pre-pass failed — review aborted (never runs without it): ${err instanceof Error ? err.message : String(err)}` }
  }
  try {
    textLayerPages = await extractPdfTextLayer(uploadedPdf)
  } catch (err) {
    console.error('[contract-review] FATAL: text-layer extraction failed:', err)
    return { ok: false, status: 500, error: `Text-layer extraction failed — review aborted (never runs without it): ${err instanceof Error ? err.message : String(err)}` }
  }
  try {
    pageImages = await renderPdfPageImages(uploadedPdf)
  } catch (err) {
    console.error('[contract-review] FATAL: page rasterization failed:', err)
    return { ok: false, status: 500, error: `Page rasterization failed — review aborted (never runs without it): ${err instanceof Error ? err.message : String(err)}` }
  }
  const redlineSourceUnknown = !manifestHasMarkup(annotationManifest)

  let standardBase64: string
  try {
    const standardBuffer = await readFile(STANDARD_AGREEMENT_PATH)
    standardBase64 = standardBuffer.toString('base64')
  } catch (err) {
    console.error('[contract-review] Standard agreement missing at', STANDARD_AGREEMENT_PATH)
    return {
      ok: false,
      status: 500,
      error: 'Standard agreement baseline is missing on the server. Contact admin.',
    }
  }

  const systemPrompt = await buildContractReviewSystemPrompt({ secondRoundClauses })

  if (process.env.CONTRACT_REVIEW_DEBUG === '1') {
    const playbookPresent = systemPrompt.includes('# SirReel Negotiation Positions')
    const hardLimitPresent = systemPrompt.includes('Non-Negotiable Hard Limits')
    console.log(
      '[contract-review] system prompt assembled — playbookHeading:',
      playbookPresent,
      'hardLimitsHeading:',
      hardLimitPresent,
      'length:',
      systemPrompt.length,
      'secondRoundClauses:',
      secondRoundClauses || [],
    )
  }

  const secondRoundHeader = formatSecondRoundClausesForUserPrompt(secondRoundClauses)

  const userText = `${companyName ? `Client company: "${companyName}".\n\n` : ''}${secondRoundHeader}When you draft \`suggestedCounter\` for any change, use the per-clause Preferred language from the playbook above as the source of truth (or the Acceptable Fallback for any clause listed in SECOND-ROUND CLAUSES). When the playbook has no entry for a clause, fall back to the baseline clause text below for voice, structure, and defined terms. The text in \`suggestedCounter\` will be rendered verbatim into the counter-PDF as the operative clause language — it must read as a complete contract clause, not as guidance or commentary. Strategic reasoning belongs in \`counterReasoning\`.

=== SIRREEL BASELINE CLAUSE TEXT (canonical source of truth absent playbook coverage) ===

${baselineClauseText()}

=== END BASELINE CLAUSE TEXT ===

Compare the client document (provided above as THREE labeled inputs: TEXT LAYER, VISUAL GROUND TRUTH page images, ANNOTATION GROUND TRUTH) against the attached baseline PDF per your instructions. Cross-check every clause across all three inputs and fill \`sourceAgreement\` on every change. Output ONLY the JSON object — no preamble, no markdown fences.`

  // Canonical three-input assembly. The baseline stays a PDF document
  // block (it is the reference, not the subject); the CLIENT document
  // arrives ONLY as the three explicit inputs so nothing is implicit.
  const textLayerBlock =
    `=== INPUT 1/3: TEXT LAYER (pdfjs extraction of the client document) ===\n\n` +
    `NOTE: PDF annotations (strikethroughs drawn over text, margin notes) do NOT alter this text — struck words still appear here as normal text.\n\n` +
    textLayerPages.map((t, i) => `[page ${i + 1}]\n${t}`).join('\n\n') +
    `\n\n=== END TEXT LAYER ===`

  const annotationBlock = manifestHasMarkup(annotationManifest)
    ? `=== INPUT 3/3: ANNOTATION GROUND TRUTH ===\n\n${formatManifestForPrompt(annotationManifest)}`
    : `=== INPUT 3/3: ANNOTATION GROUND TRUTH ===\n\nZERO annotations were extracted from this PDF — REDLINE SOURCE UNKNOWN. This does NOT mean the document is clean: redlines are frequently FLATTENED (Word tracked-changes exported to PDF, scans, or regenerated documents), leaving no annotation objects. Do NOT conclude "no changes proposed" from the absence of annotations. Instead, diff the TEXT LAYER against the baseline clause-by-clause and inspect the VISUAL page images for strikethrough glyphs, colored text, margin notes, or layout differences. Flag \`needsOperatorReview\` on anything ambiguous.`

  const content: any[] = [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf' as const, data: standardBase64 } },
    { type: 'text', text: textLayerBlock },
    {
      type: 'text',
      text: `=== INPUT 2/3: VISUAL GROUND TRUTH — the client document rendered page-by-page (${pageImages.length} page${pageImages.length === 1 ? '' : 's'}) follows. LOOK at every page: strikethroughs, red/colored text, handwriting, stamps, margin notes. ===`,
    },
    ...pageImages.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg' as const, data: img.jpegBase64 },
    })),
    { type: 'text', text: annotationBlock },
    { type: 'text', text: userText },
  ]

  const response = await client.messages.create({
    model: REVIEW_MODEL,
    // 20k — the multimodal output contract (per-change sourceAgreement
    // + full clause transcriptions) overflows 8k on heavily-marked
    // documents, truncating the JSON mid-object (Black Dog return).
    max_tokens: 20000,
    system: systemPrompt,
    messages: [{ role: 'user', content }],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : ''

  let review: any
  try {
    review = parseAiJson(text, { tag: 'contract-review', stopReason: response.stop_reason })
  } catch (parseErr) {
    return {
      ok: false,
      status: 500,
      error: 'AI response could not be parsed. Try again.',
      rawOutput: text.slice(0, 500),
    }
  }

  // Server-side deterministic stamp — never trust the model to
  // self-report its input conditions.
  if (review && typeof review === 'object') {
    review._meta = {
      ...(review._meta || {}),
      multimodal: { textLayerPages: textLayerPages.length, pageImages: pageImages.length, annotations: annotationManifest.struck.length + annotationManifest.inserted.length },
      redlineSourceUnknown,
    }
  }

  applyPostAiGuardrails(review, annotationManifest)
  return { ok: true, review, rawText: text, annotationManifest }
}

const PREFERRED_INDEMNITY_COUNTER = `Lessee/Renter ("You") agree to defend, indemnify, and hold SirReel Production Vehicles, Inc. dba SirReel Studio Rentals, our agents, employees, assignees, suppliers, sub-lessors and sub-renters ("Us" or "We") harmless from and against any and all claims, actions, causes of action, demands, rights, verifiable damages of any kind, costs, expenses and compensation whatsoever including court costs and reasonable outside attorneys' fees ("Claims"), in any way arising from, or in connection with, the Vehicles and Equipment rented/leased (which vehicles and equipment, together, are referred to in this document as "Equipment"), including, without limitation, as a result of its use, maintenance, or possession, irrespective of the cause of the Claim, except to the extent caused by Our gross negligence or willful misconduct, or by a pre-existing latent or structural defect actually known by Lessor and not disclosed to You, from the time You take care, custody or control of the Equipment until the Equipment is returned to Our care, custody and control.`

/**
 * Server-side guardrails applied after the AI returns. The AI is instructed
 * to flag these itself in `needsOperatorReview`, but we belt-and-suspenders
 * regex-scan its output too — a flag is the difference between an operator
 * catching a deal-breaker and SirReel silently shipping a bad counter-PDF.
 */
export function applyPostAiGuardrails(review: any, annotationManifest?: MarkupManifest | null): void {
  if (!review || !Array.isArray(review.changes)) return

  const baselineByRef = new Map(CANONICAL_CLAUSES.map((c) => [c.ref, c.body]))

  const hasNotAcceptable = review.changes.some((c: any) => c.type === 'not_acceptable')
  if (review.recommendation === 'approve') {
    review.recommendation = hasNotAcceptable ? 'reject' : 'counter'
    review.recommendationNote =
      '[Auto-corrected] approve is not a valid recommendation. ' + (review.recommendationNote || '')
  }
  if (hasNotAcceptable && review.recommendation !== 'reject') {
    review.recommendation = 'reject'
    review.riskLevel = 'high'
  }

  const coercedClauses: string[] = []
  const thirdPartyFlaggedClauses: string[] = []

  for (const ch of review.changes) {
    if (typeof ch.needsOperatorReview !== 'boolean') {
      ch.needsOperatorReview = false
    }
    if (ch.needsOperatorReview === false) {
      ch.operatorReviewReason = null
    }

    if (ch.type !== 'auto_approved') {
      const proposed = typeof ch.proposed === 'string' ? ch.proposed.trim() : ''
      const original = typeof ch.original === 'string' ? ch.original : ''
      const ref = String(ch.clause ?? '').trim()
      const baseline = baselineByRef.get(ref)
      if (baseline) {
        const looksLikeSummary =
          !proposed ||
          proposed.length < 80 ||
          (original.length > 0 && proposed.length < original.length * 0.5)
        if (looksLikeSummary) {
          ch.proposed = baseline
          coercedClauses.push(ref)
        }
      }
    }

    const refMatchesIndemnity = String(ch.clause ?? '').trim() === '1'
    const thirdPartyInCounter = detectThirdPartyOnlyIndemnity(ch.suggestedCounter)
    const thirdPartyInProposed = detectThirdPartyOnlyIndemnity(ch.proposed)
    if (refMatchesIndemnity || thirdPartyInCounter || thirdPartyInProposed) {
      if (thirdPartyInCounter) {
        ch.suggestedCounter = PREFERRED_INDEMNITY_COUNTER
        ch.type = 'not_acceptable'
        ch.needsOperatorReview = true
        ch.operatorReviewReason = THIRD_PARTY_AUTO_FLAG_REASON
        thirdPartyFlaggedClauses.push(String(ch.clause ?? '1'))
      } else if (thirdPartyInProposed) {
        ch.type = 'not_acceptable'
        ch.needsOperatorReview = true
        ch.operatorReviewReason =
          ch.operatorReviewReason ||
          'Client redline narrows indemnity scope to third-party claims only — Non-Negotiable Hard Limit per playbook §1.'
        thirdPartyFlaggedClauses.push(String(ch.clause ?? '1'))
      }
    }
  }

  // ── Annotation ground-truth consistency (flag-only, never rewrite) ──
  // A struck span still present verbatim in the clause's `proposed`, or
  // a client-inserted note absent from the change entirely, means the
  // model's resolution disagrees with the physical markup. We NEVER
  // auto-edit legal language here — the operator gets a named flag.
  if (annotationManifest && manifestHasMarkup(annotationManifest)) {
    for (const ch of review.changes) {
      if (ch.type === 'auto_approved') continue
      const ref = String(ch.clause ?? '').trim()
      const proposedNorm = normalizeForMatch(typeof ch.proposed === 'string' ? ch.proposed : '')
      if (proposedNorm) {
        const retained = annotationManifest.struck.filter((s) => {
          const spanNorm = normalizeForMatch(s.text)
          // Short fragments ("carrier.") false-positive on normal prose;
          // only enforce spans with real phrase weight.
          if (spanNorm.length < 10) return false
          if (!clauseMatches(s.clauseGuess, ref)) return false
          return proposedNorm.includes(spanNorm)
        })
        if (retained.length > 0) {
          ch.needsOperatorReview = true
          const spans = retained.map((s) => `"${s.text}"`).join(', ')
          const msg = `Markup mismatch: the client physically struck ${spans} (clause ${ref}) but \`proposed\` still contains it. Verify against the source PDF before using this text.`
          ch.operatorReviewReason = ch.operatorReviewReason ? `${ch.operatorReviewReason} ${msg}` : msg
        }
      }
      // Inserted notes anchored to this clause should surface somewhere
      // in the change (proposed, description, or reasoning).
      const combinedNorm = normalizeForMatch(
        [ch.proposed, ch.description, ch.reasoning]
          .filter((v) => typeof v === 'string')
          .join(' '),
      )
      const droppedNotes = annotationManifest.inserted.filter((n) => {
        if (!clauseMatches(n.clauseGuess, ref)) return false
        const sig = normalizeForMatch(n.text)
          .split(' ')
          .filter((w) => w.length > 4)
        if (sig.length === 0) return false
        const present = sig.filter((w) => combinedNorm.includes(w)).length
        return present / sig.length < 0.5
      })
      if (droppedNotes.length > 0) {
        ch.needsOperatorReview = true
        const notes = droppedNotes.map((n) => `"${n.text}"`).join(', ')
        const msg = `Markup mismatch: the client inserted a note near clause ${ref} (${notes}) that this change does not account for.`
        ch.operatorReviewReason = ch.operatorReviewReason ? `${ch.operatorReviewReason} ${msg}` : msg
      }
    }
  }

  // ── Three-source reconciliation (flag-only, never auto-resolve) ──
  // The model reports what each input showed per clause; a declared
  // disagreement always reaches the operator. We never pick a winner
  // and never rewrite legal text.
  for (const ch of review.changes) {
    if (ch.type === 'auto_approved') continue
    const sa = ch.sourceAgreement
    if (sa && sa.agree === false) {
      ch.needsOperatorReview = true
      const msg = `Source disagreement — text layer: "${String(sa.textLayer ?? '').slice(0, 120)}" · manifest: "${String(sa.manifest ?? '').slice(0, 120)}" · image: "${String(sa.image ?? '').slice(0, 120)}". Verify against the source PDF; do not trust any single reading.`
      ch.operatorReviewReason = ch.operatorReviewReason ? `${ch.operatorReviewReason} ${msg}` : msg
    }
  }

  if (thirdPartyFlaggedClauses.length > 0) {
    review.recommendation = 'reject'
    review.riskLevel = 'high'
    review.recommendationNote =
      `[Auto-flagged] Third-party-only indemnity detected on clause${thirdPartyFlaggedClauses.length === 1 ? '' : 's'} ${[...new Set(thirdPartyFlaggedClauses)].join(', ')} — Non-Negotiable Hard Limit. ` +
      (review.recommendationNote || '')
  }

  if (coercedClauses.length > 0) {
    review.recommendationNote =
      `[Auto-corrected] proposed for clause${coercedClauses.length === 1 ? '' : 's'} ${coercedClauses.join(', ')} looked like a summary; replaced with canonical baseline. ` +
      (review.recommendationNote || '')
  }
}
