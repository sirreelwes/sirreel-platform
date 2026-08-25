import { prisma } from '@/lib/prisma'
import { readPrivateBlobBuffer } from '@/lib/claims/streamBlob'
import { runCoiAiReview } from './reviewCoi'
import { coiCheckWriteFields, hasCoiChecklist } from './checks'

/**
 * Re-run the AI review against a certificate's STORED file and persist the
 * result. One implementation, two callers: the "Run AI review" button in
 * CoiReviewModal and scripts/backfill-coi-named-insured.ts.
 *
 * Shared deliberately. Reviews filed before `namedInsured` was added to the
 * prompt have no insured name in them at all, and reviews filed before the
 * checklist unification never asked about Primary & Non-Contributory,
 * Waiver of Subrogation, Umbrella, Workers Comp, the cancellation clause or
 * contractor coverage. Both read as gaps until the document is looked at
 * again — and a backfill that wrote those rows with different rules than the
 * button would leave two classes of reviewed certificate that disagree about
 * what "reviewed" means.
 */
export type RerunOutcome =
  | {
      ok: true
      namedInsured: string | null
      gainedName: boolean
      /** The re-run produced per-check verdicts where the old one had none. */
      gainedChecklist: boolean
      riskLevel: string
    }
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
      aiResponse: true,
      deletedAt: true,
    },
  })
  if (!existing || existing.deletedAt) return { ok: false, error: 'not found' }

  const buffer = await readPrivateBlobBuffer(existing.fileUrl)
  if (!buffer) return { ok: false, error: 'Could not read the stored file to review it.' }

  const ai = await runCoiAiReview(buffer, existing.mimeType || 'application/pdf')
  const fields = coiCheckWriteFields(ai)
  const namedInsured = fields.namedInsured ?? existing.namedInsured
  const hadChecklist = hasCoiChecklist(existing.aiResponse as never)

  await prisma.coiCheck.update({
    where: { id },
    data: {
      aiResponse: fields.aiResponse,
      aiRiskLevel: fields.aiRiskLevel,
      aiRecommendation: fields.aiRecommendation,
      namedInsured,
      // Never downgrade an expiry a human typed in; only fill a blank.
      ...(existing.policyExpiryDate == null && fields.policyExpiryDate
        ? { policyExpiryDate: fields.policyExpiryDate }
        : {}),
      // AI never flips additionalInsured off — it only confirms it.
      ...(fields.additionalInsured ? { additionalInsured: true } : {}),
      // coverageVerified is a HUMAN sign-off. A re-run re-reads the document;
      // it does not un-approve what a reviewer already approved, and it does
      // not approve on their behalf.
    },
  })

  return {
    ok: true,
    namedInsured,
    gainedName: !existing.namedInsured && !!namedInsured,
    gainedChecklist: !hadChecklist && hasCoiChecklist(ai),
    riskLevel: fields.aiRiskLevel,
  }
}
