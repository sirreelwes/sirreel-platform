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

const STANDARD_AGREEMENT_PATH = path.join(
  process.cwd(),
  'public',
  'contracts',
  'sirreel-rental-agreement.pdf'
)

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface RunReviewInput {
  uploadedBase64: string
  companyName?: string
  secondRoundClauses?: string[]
}

export type RunReviewResult =
  | { ok: true; review: any; rawText: string }
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
  const { uploadedBase64, companyName, secondRoundClauses } = input

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

  const userText = `The first attached PDF is the client's redlined version of our rental agreement (look for red text, strikethroughs, and underlined additions).

The second PDF is SirReel's clean standard rental agreement baseline.

${companyName ? `Client company: "${companyName}".\n\n` : ''}${secondRoundHeader}When you draft \`suggestedCounter\` for any change, use the per-clause Preferred language from the playbook above as the source of truth (or the Acceptable Fallback for any clause listed in SECOND-ROUND CLAUSES). When the playbook has no entry for a clause, fall back to the baseline clause text below for voice, structure, and defined terms. The text in \`suggestedCounter\` will be rendered verbatim into the counter-PDF as the operative clause language — it must read as a complete contract clause, not as guidance or commentary. Strategic reasoning belongs in \`counterReasoning\`.

=== SIRREEL BASELINE CLAUSE TEXT (canonical source of truth absent playbook coverage) ===

${baselineClauseText()}

=== END BASELINE CLAUSE TEXT ===

Compare the redlined document against the baseline per your instructions. Output ONLY the JSON object — no preamble, no markdown fences.`

  const content: any[] = [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf' as const, data: uploadedBase64 } },
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf' as const, data: standardBase64 } },
    { type: 'text', text: userText },
  ]

  const response = await client.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 8000,
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

  applyPostAiGuardrails(review)
  return { ok: true, review, rawText: text }
}

const PREFERRED_INDEMNITY_COUNTER = `Lessee/Renter ("You") agree to defend, indemnify, and hold SirReel Production Vehicles, Inc. dba SirReel Studio Rentals, our agents, employees, assignees, suppliers, sub-lessors and sub-renters ("Us" or "We") harmless from and against any and all claims, actions, causes of action, demands, rights, verifiable damages of any kind, costs, expenses and compensation whatsoever including court costs and reasonable outside attorneys' fees ("Claims"), in any way arising from, or in connection with, the Vehicles and Equipment rented/leased (which vehicles and equipment, together, are referred to in this document as "Equipment"), including, without limitation, as a result of its use, maintenance, or possession, irrespective of the cause of the Claim, except to the extent caused by Our gross negligence or willful misconduct, or by a pre-existing latent or structural defect actually known by Lessor and not disclosed to You, from the time You take care, custody or control of the Equipment until the Equipment is returned to Our care, custody and control.`

/**
 * Server-side guardrails applied after the AI returns. The AI is instructed
 * to flag these itself in `needsOperatorReview`, but we belt-and-suspenders
 * regex-scan its output too — a flag is the difference between an operator
 * catching a deal-breaker and SirReel silently shipping a bad counter-PDF.
 */
export function applyPostAiGuardrails(review: any): void {
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
