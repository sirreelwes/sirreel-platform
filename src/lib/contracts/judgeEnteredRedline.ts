/**
 * The AI's read of an OPERATOR-ENTERED redline — clause text, no PDF.
 *
 * Wes 2026-09-07, on a redline he had entered by hand: "If we are to
 * approve this (as AI recommends) I want to know more detail and why" and,
 * on seeing every row pre-marked Accept, "I haven't accepted anything."
 * Until now an entered redline was never judged at all: the entry route
 * synthesised the changes[] shape with type 'auto_approved' and the AI's
 * "recommendation" was the operator's own entry echoed back.
 *
 * This runs the SAME system prompt (playbook, hard limits, output contract)
 * as the PDF review, with a text-only user message: for each amended clause
 * the baseline and the client's proposed text. The canonical PDF pipeline
 * refuses to run without its three inputs (text layer, annotations, page
 * images) because a PDF can hide markup in any of them; typed text has
 * exactly one input, so there is nothing to cross-check and
 * `sourceAgreement` is null on every change.
 *
 * What is kept from the entry: `original` and `proposed` (the operator's
 * text is the ground truth here, not the model's transcription). What the
 * model supplies: type, description, reasoning, suggestedCounter,
 * counterReasoning, playbookSource, needsOperatorReview. Operator decisions
 * are never touched; the outgoing analysis is archived to aiResponseHistory
 * like any re-run.
 */
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { REVIEW_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'
import { buildContractReviewSystemPrompt, formatSecondRoundClausesForUserPrompt } from '@/lib/contracts/reviewPrompt'
import { applyPostAiGuardrails, baselineClauseText } from '@/lib/contracts/runReview'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: globalThis.fetch as any })

export type JudgeResult =
  | { ok: true; review: any }
  | { ok: false; error: string; status: number; rawOutput?: string }

export function isOperatorEnteredReview(record: { fileKey: string | null; annotationManifest: unknown; aiResponse: unknown }): boolean {
  const m = record.annotationManifest as { source?: string } | null
  const meta = (record.aiResponse as { _meta?: { source?: string } } | null)?._meta
  return !record.fileKey && (m?.source === 'OPERATOR_ENTERED' || meta?.source === 'OPERATOR_ENTERED')
}

export async function judgeEnteredRedline(input: { reviewId: string; byUserId: string; secondRoundClauses?: string[] }): Promise<JudgeResult> {
  const record = await prisma.contractReview.findUnique({
    where: { id: input.reviewId },
    select: { id: true, fileKey: true, aiResponse: true, aiResponseHistory: true, aiRiskLevel: true, aiRecommendation: true, annotationManifest: true, company: { select: { name: true } } },
  })
  if (!record) return { ok: false, status: 404, error: 'Review not found' }
  if (!isOperatorEnteredReview(record)) return { ok: false, status: 400, error: 'Not an operator-entered redline — use the PDF re-run.' }

  const current = record.aiResponse as any
  const entered: Array<{ clause: string; original: string; proposed: string; description?: string }> = Array.isArray(current?.changes)
    ? current.changes.map((c: any) => ({ clause: String(c.clause ?? ''), original: String(c.original ?? ''), proposed: String(c.proposed ?? ''), description: c.description }))
    : []
  if (entered.length === 0) return { ok: false, status: 400, error: 'This review has no entered clauses to judge.' }

  const secondRoundClauses = input.secondRoundClauses ?? (current?._meta?.secondRoundClauses as string[] | undefined) ?? []
  const systemPrompt = await buildContractReviewSystemPrompt({ secondRoundClauses })
  const companyName = record.company?.name || ''

  const clauseBlocks = entered
    .map((c) => `--- CLAUSE ${c.clause} ---\nBASELINE (SirReel):\n${c.original}\n\nCLIENT PROPOSED (typed in by our operator from the client's redline):\n${c.proposed}\n`)
    .join('\n')

  const userText = `${companyName ? `Client company: "${companyName}".\n\n` : ''}${formatSecondRoundClausesForUserPrompt(secondRoundClauses)}THIS REDLINE ARRIVED AS TEXT, NOT A PDF. There is no text layer, no annotation manifest and no page image — a SirReel operator typed the client's amended clauses from the redline they sent. Treat the CLIENT PROPOSED text below as the exact wording the client is asking for. Do not describe what "the PDF shows"; there is none. Set \`sourceAgreement\` to null on every change.

Judge EVERY clause listed below against your instructions and the playbook — return exactly one entry in \`changes\` per clause, in the same order, with \`clause\` set to the clause number given. Classify each as auto_approved, needs_review or not_acceptable per the risk rules. Do NOT echo the clause texts back: return \`original\` and \`proposed\` as empty strings "" on every change (we keep the operator's text) — spend your output on \`reasoning\`, \`suggestedCounter\` and \`counterReasoning\`. Keep \`reasoning\` to three or four sentences. When you draft \`suggestedCounter\`, use the per-clause Preferred language from the playbook (or the Acceptable Fallback for any clause listed in SECOND-ROUND CLAUSES); when the playbook has no entry, use the baseline clause text below for voice, structure and defined terms. \`suggestedCounter\` is rendered verbatim into the counter-PDF; strategic reasoning belongs in \`counterReasoning\`. In \`reasoning\`, say plainly what the client's change does to SirReel's position and why it lands in that category.

=== AMENDED CLAUSES ===

${clauseBlocks}
=== END AMENDED CLAUSES ===

=== SIRREEL BASELINE CLAUSE TEXT (canonical source of truth absent playbook coverage) ===

${baselineClauseText()}

=== END BASELINE CLAUSE TEXT ===

Output ONLY the JSON object — no preamble, no markdown fences.`

  let raw = ''
  let stopReason: string | null = null
  try {
    const response = await client.messages.create({
      model: REVIEW_MODEL,
      // Verdicts + counters only (texts are not echoed) — sixteen clauses fit
      // well inside this; the PDF review's 20k budget was for transcription.
      max_tokens: 12000,
      system: systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    })
    stopReason = response.stop_reason
    raw = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n')
  } catch (err) {
    return { ok: false, status: 502, error: `AI review failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  let judged: any
  try {
    judged = parseAiJson<any>(raw, { tag: 'judge-entered-redline', stopReason })
  } catch (err) {
    return { ok: false, status: 502, error: `AI returned unparseable output: ${err instanceof Error ? err.message : String(err)}`, rawOutput: raw.slice(0, 4000) }
  }
  applyPostAiGuardrails(judged, null)

  // Merge: the operator's text is the ground truth; the model's verdict is
  // the news. Match by clause number; a clause the model skipped keeps
  // 'needs_review' with an honest note rather than vanishing.
  const byClause = new Map<string, any>()
  for (const c of Array.isArray(judged?.changes) ? judged.changes : []) byClause.set(String(c.clause ?? '').trim(), c)
  const changes = entered.map((e) => {
    const j = byClause.get(e.clause)
    if (!j) {
      return { ...(current.changes.find((c: any) => String(c.clause) === e.clause) ?? {}), clause: e.clause, original: e.original, proposed: e.proposed, type: 'needs_review', reasoning: 'The AI did not return a verdict for this clause — review it by hand.', playbookSource: 'not_covered', sourceAgreement: null }
    }
    const type = ['auto_approved', 'needs_review', 'not_acceptable'].includes(j.type) ? j.type : 'needs_review'
    return {
      clause: e.clause,
      type,
      description: typeof j.description === 'string' && j.description.trim() ? j.description : e.description ?? `Client redline to clause ${e.clause}`,
      original: e.original,
      proposed: e.proposed,
      reasoning: typeof j.reasoning === 'string' ? j.reasoning : '',
      suggestedCounter: type === 'auto_approved' ? null : (typeof j.suggestedCounter === 'string' && j.suggestedCounter.trim() ? j.suggestedCounter : null),
      counterReasoning: typeof j.counterReasoning === 'string' ? j.counterReasoning : null,
      playbookSource: typeof j.playbookSource === 'string' ? j.playbookSource : 'not_covered',
      needsOperatorReview: j.needsOperatorReview === true,
      operatorReviewReason: typeof j.operatorReviewReason === 'string' ? j.operatorReviewReason : null,
      sourceAgreement: null,
    }
  })
  const counts = {
    autoApprovedCount: changes.filter((c) => c.type === 'auto_approved').length,
    needsReviewCount: changes.filter((c) => c.type === 'needs_review').length,
    notAcceptableCount: changes.filter((c) => c.type === 'not_acceptable').length,
  }
  const riskLevel = ['low', 'medium', 'high'].includes(judged?.riskLevel) ? judged.riskLevel : counts.notAcceptableCount ? 'high' : counts.needsReviewCount ? 'medium' : 'low'
  const recommendation = ['approve', 'counter', 'reject'].includes(judged?.recommendation) ? judged.recommendation : counts.notAcceptableCount + counts.needsReviewCount ? 'counter' : 'approve'

  const review = {
    ...current,
    summary: typeof judged?.summary === 'string' && judged.summary.trim() ? judged.summary : current.summary,
    riskLevel,
    recommendation,
    recommendationNote: typeof judged?.recommendationNote === 'string' ? judged.recommendationNote : current.recommendationNote,
    ...counts,
    comparisonPerformed: true,
    comparisonNote: 'Operator-entered redline judged from the typed clause text against the playbook and baseline. No PDF, so no annotation or page-image cross-check.',
    changes,
    _meta: { ...(current._meta || {}), judgedAt: new Date().toISOString(), judgedById: input.byUserId, secondRoundClauses },
  }

  const history = Array.isArray(record.aiResponseHistory) ? [...(record.aiResponseHistory as any[])] : []
  history.push({ aiResponse: record.aiResponse, aiRiskLevel: record.aiRiskLevel, aiRecommendation: record.aiRecommendation, archivedAt: new Date().toISOString(), archivedByRerunOf: input.byUserId })

  await prisma.$transaction([
    prisma.contractReview.update({
      where: { id: record.id },
      data: { aiResponse: review, aiRiskLevel: riskLevel, aiRecommendation: recommendation, aiResponseHistory: history },
    }),
    // Keep the per-clause decision rows' changeType in step with the verdict
    // (the decision itself — PENDING/ACCEPT/… — is the operator's and untouched).
    ...changes.map((c, i) =>
      prisma.reviewChangeDecision.updateMany({ where: { reviewId: record.id, changeIndex: i }, data: { changeType: c.type } }),
    ),
  ])
  return { ok: true, review }
}
