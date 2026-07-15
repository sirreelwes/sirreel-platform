import { get } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { runContractReviewAi } from '@/lib/contracts/runReview'
import { buildAnnotationManifest, type MarkupManifest } from '@/lib/contracts/annotationManifest'

export interface RerunInput {
  reviewId: string
  rerunById: string
  secondRoundClauses?: string[]
}

export type RerunResult =
  | { ok: true; review: any; annotationManifest: MarkupManifest | null }
  | { ok: false; error: string; status: number; rawOutput?: string }

/**
 * Re-run the AI analysis for an existing ContractReview, shared by the
 * rerun API route and operational scripts so both take the identical
 * pipeline (annotation pre-pass included).
 *
 * NON-DESTRUCTIVE: the outgoing aiResponse (+ risk/recommendation and
 * timestamp) is appended to aiResponseHistory before being replaced, so
 * every analysis the operator ever saw stays auditable. Operator rows
 * (ReviewChangeDecision, humanDecision fields) are never touched.
 */
export async function rerunContractReview(input: RerunInput): Promise<RerunResult> {
  const { reviewId, rerunById } = input
  const secondRoundClauses = (input.secondRoundClauses ?? []).map((s) => s.trim()).filter(Boolean)

  const record = await prisma.contractReview.findFirst({
    where: { id: reviewId, deletedAt: null },
    include: { company: { select: { name: true } } },
  })
  if (!record) return { ok: false, error: 'Not found', status: 404 }
  if (!record.fileKey) {
    return {
      ok: false,
      error: 'Original file no longer available (retention cleanup) — cannot re-run.',
      status: 410,
    }
  }

  let fileBuffer: Buffer
  try {
    const blob = await get(record.fileKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return { ok: false, error: 'Original file not retrievable', status: 502 }
    }
    const chunks: Buffer[] = []
    const reader = blob.stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(Buffer.from(value))
    }
    fileBuffer = Buffer.concat(chunks)
  } catch (err) {
    console.error('[contract-review][rerun] failed to fetch blob:', err)
    return { ok: false, error: 'Failed to load original file', status: 500 }
  }

  // Deterministic markup pre-pass. Extraction failure never blocks the
  // re-run — the AI call just runs without the ground-truth block.
  let annotationManifest: MarkupManifest | null = null
  try {
    annotationManifest = await buildAnnotationManifest(fileBuffer)
  } catch (err) {
    console.warn('[contract-review][rerun] annotation manifest extraction failed:', err)
  }

  const result = await runContractReviewAi({
    uploadedBase64: fileBuffer.toString('base64'),
    companyName: record.company?.name || '',
    secondRoundClauses,
    annotationManifest,
  })
  if (!result.ok) return result

  const review = result.review
  if (review && typeof review === 'object') {
    review._meta = {
      ...(review._meta || {}),
      secondRoundClauses,
      rerunAt: new Date().toISOString(),
      rerunById,
    }
  }

  // Archive the outgoing analysis, newest last. History is a plain JSON
  // array on the row; reruns are rare (operator-triggered) so unbounded
  // growth isn't a concern.
  const history = Array.isArray(record.aiResponseHistory) ? [...record.aiResponseHistory] : []
  history.push({
    aiResponse: record.aiResponse,
    aiRiskLevel: record.aiRiskLevel,
    aiRecommendation: record.aiRecommendation,
    archivedAt: new Date().toISOString(),
    archivedByRerunOf: rerunById,
  })

  await prisma.contractReview.update({
    where: { id: reviewId },
    data: {
      aiResponse: review,
      aiRiskLevel: typeof review.riskLevel === 'string' ? review.riskLevel : null,
      aiRecommendation: typeof review.recommendation === 'string' ? review.recommendation : null,
      annotationManifest: annotationManifest
        ? (JSON.parse(JSON.stringify(annotationManifest)) as object)
        : undefined,
      aiResponseHistory: history,
    },
  })

  return { ok: true, review, annotationManifest }
}
