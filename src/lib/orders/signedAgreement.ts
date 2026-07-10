import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { generateCounterPdf } from '@/lib/contracts/generateCounterPdf'

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

  // Render the review document UP FRONT (2026-07): the client must be able to
  // review the approved clause text BEFORE signing, so documentToSignUrl is
  // populated the moment the baseline row exists — not lazily on first portal
  // read. Renders from contractClauses.ts via ContractDocument (the SAME
  // module source SignedAgreementDocument re-renders at sign-time, so review
  // and signed text cannot diverge). Best-effort: a render/blob hiccup leaves
  // the existing lazy fill paths (portal read / release / welcome click) to
  // repair it — this helper's callers must never break on a render failure.
  // Fires only on first creation (the `existing` guard above), so hot paths
  // pay the ~300ms render exactly once per order.
  await ensureBaselineRentalDocumentToSign(orderId).catch((err) => {
    console.error('[ensureSignedAgreementForOrder] up-front baseline render failed (lazy fill will retry):', orderId, err)
  })
}

/**
 * Render + persist the BASELINE rental agreement's "document to sign" from
 * the APPROVED canonical clauses so the client reviews/signs the approved
 * text in the native portal flow.
 *
 * The clause text comes straight from ContractDocument → contractClauses.ts
 * (the approved 1–29 + rental policies + fleet agreement + LCDW addendum),
 * rendered with NO ai-changes / decisions, so the output is the verbatim
 * approved set. This ONLY selects the source document — it does not alter,
 * reword, or reorder any clause text.
 *
 * Why this exists: a plain BASELINE row is created with documentToSignUrl =
 * null (see above), and the release gate refuses to release a null-doc
 * agreement — so the native rental sign flow was blocked and had no
 * approved-clause PDF for the client. This fills that gap.
 *
 * Narrowly scoped + idempotent:
 *   - BASELINE only (never NEGOTIATED — that points at a company/counter PDF)
 *   - only when documentToSignUrl is still null (never regenerate/overwrite)
 *   - never touch a SIGNED_* row
 * Returns the resolved documentToSignUrl (existing or newly generated), or
 * null when there's no baseline row to fill. Callers should treat a throw as
 * non-fatal (wrap best-effort) so a render/blob hiccup never breaks the view.
 */
export async function ensureBaselineRentalDocumentToSign(orderId: string): Promise<string | null> {
  const agreement = await prisma.signedAgreement.findUnique({
    where: { orderId_contractType: { orderId, contractType: 'RENTAL_AGREEMENT' } },
    select: { id: true, status: true, documentType: true, documentToSignUrl: true },
  })
  if (!agreement) return null
  if (agreement.documentType !== 'BASELINE') return agreement.documentToSignUrl
  if (agreement.documentToSignUrl) return agreement.documentToSignUrl
  if (agreement.status === 'SIGNED_BASELINE' || agreement.status === 'SIGNED_NEGOTIATED') {
    return agreement.documentToSignUrl
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      company: {
        select: { name: true, industry: true, billingAddress: true, billingEmail: true, notes: true },
      },
      job: {
        select: { jobCode: true, name: true, startDate: true, endDate: true },
      },
    },
  })

  const company = order?.company
    ? {
        name: order.company.name,
        industry: order.company.industry,
        billingAddress: order.company.billingAddress,
        billingEmail: order.company.billingEmail,
        notes: order.company.notes,
      }
    : null
  const job = order?.job
    ? {
        jobCode: order.job.jobCode,
        name: order.job.name,
        startDate: order.job.startDate,
        endDate: order.job.endDate,
        primaryContact: null,
      }
    : null

  // Empty ai-changes/decisions → verbatim approved clause set.
  const pdf = await generateCounterPdf({
    company,
    job,
    aiChanges: [],
    decisions: [],
    generatedAt: new Date(),
    grantedScope: null,
    // Baseline document-to-sign — NOT a counter proposal.
    documentTitle: 'Rental Agreement',
  })

  const blobKey = `agreement-baseline/${orderId}/baseline-${Date.now()}.pdf`
  const uploaded = await put(blobKey, pdf, { access: 'private', contentType: 'application/pdf' })

  await prisma.signedAgreement.update({
    where: { id: agreement.id },
    data: { documentToSignUrl: uploaded.url },
  })
  return uploaded.url
}
