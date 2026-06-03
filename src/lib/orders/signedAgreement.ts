import { prisma } from '@/lib/prisma'

/**
 * Idempotently create the rental-agreement SignedAgreement for an Order.
 * Called when an Order transitions to quoteStatus=SENT (which is when the
 * paperwork-portal magic link is generated). Returns the existing record
 * if one already exists.
 *
 * Stage-contract rows (contractType=STAGE_CONTRACT) are created by a
 * separate flow at /api/orders/[id]/generate-stage-contract — this helper
 * only manages the RENTAL_AGREEMENT row because that's the one the
 * paperwork-portal flow auto-creates per order.
 *
 * Path A standing-agreement wiring (commit "auto-apply company
 * negotiated terms"): if the Order's Company has a recorded
 * negotiated standing agreement and it's active as of today, the
 * new SignedAgreement is created pre-pointed at the company's
 * negotiated PDF (documentType=NEGOTIATED, documentToSignUrl=the
 * company's stored PDF, status=NEGOTIATED_READY). The client sees
 * the negotiated terms on first portal visit — no agent action,
 * no re-papering. Otherwise we fall back to the baseline path
 * exactly as before.
 *
 * Idempotent for ANY existing row — if one already exists (baseline
 * or negotiated, sent or signed), we leave it. An order that was
 * already papered on baseline before the company's standing terms
 * were recorded keeps its baseline. Never overwrite a sent or signed
 * agreement.
 *
 * The baselineVersion is stamped with the date the record is first
 * created so later audits can tell which canonical baseline the
 * client originally saw. NEGOTIATED rows leave it null since the
 * canonical document is the company's PDF, not a versioned
 * template.
 */
export async function ensureSignedAgreementForOrder(orderId: string): Promise<void> {
  const existing = await prisma.signedAgreement.findUnique({
    where: { orderId_contractType: { orderId, contractType: 'RENTAL_AGREEMENT' } },
    select: { id: true },
  })
  if (existing) return

  // Look up the Company's standing agreement state. Only the few
  // fields we need to decide whether to auto-apply.
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      company: {
        select: {
          negotiatedTermsUrl: true,
          negotiatedTermsApprovedAt: true,
          negotiatedTermsActiveAsOf: true,
        },
      },
    },
  })

  const now = new Date()
  const co = order?.company
  const hasStanding =
    !!co?.negotiatedTermsUrl &&
    !!co.negotiatedTermsApprovedAt &&
    (co.negotiatedTermsActiveAsOf == null || co.negotiatedTermsActiveAsOf <= now)

  if (hasStanding && co) {
    await prisma.signedAgreement.create({
      data: {
        orderId,
        contractType: 'RENTAL_AGREEMENT',
        // NEGOTIATED_READY is the same state the client lands on
        // after operator-side counter-PDF generation — the portal
        // already knows how to show "this is the negotiated doc,
        // sign it" from this state.
        status: 'NEGOTIATED_READY',
        documentType: 'NEGOTIATED',
        documentToSignUrl: co.negotiatedTermsUrl,
        // baselineVersion intentionally left null — the canonical
        // document is the company's stored PDF, not a versioned
        // template.
      },
    })
    return
  }

  const today = now.toISOString().slice(0, 10)
  await prisma.signedAgreement.create({
    data: {
      orderId,
      contractType: 'RENTAL_AGREEMENT',
      status: 'PORTAL_GENERATED',
      documentType: 'BASELINE',
      baselineVersion: today,
    },
  })
}
