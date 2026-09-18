import { prisma } from '@/lib/prisma'
import { readPrivateBlobBuffer } from '@/lib/claims/streamBlob'
import { runCoiAiReview } from './reviewCoi'
import { coiCheckWriteFields, hasCoiChecklist } from './checks'
import { COI_SCOPE_SELECT, deriveCoiScope } from './jobScope'
import { brokerFactsFromReview, recordBroker } from './brokerDirectory'

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
      // For the broker directory — which client this certificate is for.
      companyId: true,
      company: { select: { id: true } },
      // Vehicle scope, so the stored recommendation matches what the desk is
      // shown: no truck on the job, no auto requirement to flag it for
      // (src/lib/coi/vehicleScope.ts).
      job: { select: { companyId: true, ...COI_SCOPE_SELECT } },
    },
  })
  if (!existing || existing.deletedAt) return { ok: false, error: 'not found' }

  const buffer = await readPrivateBlobBuffer(existing.fileUrl)
  if (!buffer) return { ok: false, error: 'Could not read the stored file to review it.' }

  const ai = await runCoiAiReview(buffer, existing.mimeType || 'application/pdf')
  const fields = coiCheckWriteFields(ai, {
    ...deriveCoiScope(existing.job ?? {}).ctx,
  })
  const namedInsured = fields.namedInsured ?? existing.namedInsured
  const hadChecklist = hasCoiChecklist(existing.aiResponse as never)

  await prisma.coiCheck.update({
    where: { id },
    data: {
      aiResponse: fields.aiResponse,
      aiRiskLevel: fields.aiRiskLevel,
      aiRecommendation: fields.aiRecommendation,
      namedInsured,
      // Expiry may be filled in, or moved EARLIER — never later.
      //
      // The old rule here was "only fill a blank", on the reasoning that a
      // stored date is one a human typed. It isn't: the AI writes this column
      // on first upload, so a misread was permanent. Pop Up Mob's certificate
      // carried 2027-02-06 (its Workers Comp row) while the General Liability
      // and Auto rows had lapsed on 2026-06-15, and no amount of re-reviewing
      // could correct it.
      //
      // Moving the date earlier only ever SHORTENS the period we treat as
      // covered, so it is the safe direction to take from a re-read. Pushing
      // an expiry later extends assumed coverage and stays a human's call.
      ...(fields.policyExpiryDate &&
      (existing.policyExpiryDate == null || fields.policyExpiryDate < existing.policyExpiryDate)
        ? { policyExpiryDate: fields.policyExpiryDate }
        : {}),
      // AI never flips additionalInsured off — it only confirms it.
      ...(fields.additionalInsured ? { additionalInsured: true } : {}),
      // coverageVerified is a HUMAN sign-off. A re-run re-reads the document;
      // it does not un-approve what a reviewer already approved, and it does
      // not approve on their behalf.
    },
  })

  // File the broker this certificate names (Wes 2026-09-17: "start keeping a
  // list of brokers"). The re-run is where a producer box is first READ on
  // older certificates, so it is the path that back-fills the directory.
  // Best-effort: a review that succeeded must not fail over a list.
  await recordBroker({
    facts: brokerFactsFromReview(ai),
    source: 'CERTIFICATE',
    companyId: existing.job?.companyId ?? existing.companyId ?? existing.company?.id ?? null,
    insuredName: namedInsured,
  })

  return {
    ok: true,
    namedInsured,
    gainedName: !existing.namedInsured && !!namedInsured,
    gainedChecklist: !hadChecklist && hasCoiChecklist(ai),
    riskLevel: fields.aiRiskLevel,
  }
}
