import { prisma } from '@/lib/prisma'
import { readPrivateBlobBuffer } from '@/lib/claims/streamBlob'
import { runCoiAiReview } from './reviewCoi'

/**
 * Re-run the AI review against a certificate's STORED file and persist the
 * result. One implementation, two callers: the "Run AI review" button in
 * CoiReviewModal and scripts/backfill-coi-named-insured.ts.
 *
 * Shared deliberately. Every review filed before `namedInsured` was added to
 * the prompt has no insured name in it at all, so the name match reads
 * UNKNOWN until the document is looked at again — and a backfill that wrote
 * those rows with different rules than the button would leave two classes of
 * reviewed certificate that disagree about what "reviewed" means.
 */
export type RerunOutcome =
  | { ok: true; namedInsured: string | null; gainedName: boolean }
  | { ok: false; error: string }

export async function rerunCoiAiReview(id: string): Promise<RerunOutcome> {
  const existing = await prisma.coiCheck.findUnique({
    where: { id },
    select: {
      id: true,
      fileUrl: true,
      mimeType: true,
      namedInsured: true,
      policyExpiryDate: true,
      deletedAt: true,
    },
  })
  if (!existing || existing.deletedAt) return { ok: false, error: 'not found' }

  const buffer = await readPrivateBlobBuffer(existing.fileUrl)
  if (!buffer) return { ok: false, error: 'Could not read the stored file to review it.' }

  const ai = await runCoiAiReview(buffer, existing.mimeType || 'application/pdf')
  const aiExpiry =
    typeof ai.policyExpiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ai.policyExpiryDate)
      ? new Date(ai.policyExpiryDate)
      : null
  const namedInsured =
    typeof ai.namedInsured === 'string' && ai.namedInsured.trim()
      ? ai.namedInsured.trim().slice(0, 300)
      : existing.namedInsured

  await prisma.coiCheck.update({
    where: { id },
    data: {
      aiResponse: ai as object,
      aiRiskLevel: typeof ai.riskLevel === 'string' ? ai.riskLevel : null,
      aiRecommendation: ai.overallPass ? 'accept' : 'review',
      namedInsured,
      // Never downgrade an expiry a human typed in; only fill a blank.
      ...(existing.policyExpiryDate == null && aiExpiry ? { policyExpiryDate: aiExpiry } : {}),
      // AI never flips additionalInsured off — it only confirms it.
      ...(ai.additionalInsured === true ? { additionalInsured: true } : {}),
    },
  })

  return { ok: true, namedInsured, gainedName: !existing.namedInsured && !!namedInsured }
}
