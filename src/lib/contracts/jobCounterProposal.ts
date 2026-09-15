/**
 * A job's current counter-proposal — the PDF SirReel generated in answer to
 * the client's redline.
 *
 * Wes 2026-09-15: once the clauses are decided and the PDF is generated, "that
 * PDF is not easily placed in the portal nor is it easy to reply to the
 * client … it should be sent to the portal — the job portal as well as our
 * agent's job detail page — and in the portal we can also choose to send to
 * the client."
 *
 * So generating IS posting: there is no separate publish step. The newest
 * live review on the job with a counter-PDF is the one both sides see — the
 * client portal row (/api/portal/job/counter-proposal), the staff job page
 * card, and the "Send to client" composer, which attaches the same bytes.
 * One lookup here so the three cannot disagree about which review counts.
 *
 * Job-scoped, not order-scoped: a redline is on the production's agreement
 * (see the operator-entered redline notes), and a review uploaded at
 * /tools/contract-review carries a jobId without ever touching an order.
 * A review with no job is not posted anywhere — there is nowhere to post it.
 */

import { get } from '@vercel/blob'
import { prisma } from '@/lib/prisma'

export const COUNTER_SENT_ACTION = 'contract_review.counter_sent'

/**
 * Counter-proposals generated before posting existed were never meant for a
 * client's eyes — some were superseded or settled by phone. Only PDFs cut on
 * or after the day this shipped are posted; regenerating an older review
 * posts it like any new one.
 */
export const COUNTER_POSTING_STARTED = new Date('2026-09-15T00:00:00Z')

export async function latestCounterProposalForJob(jobId: string) {
  return prisma.contractReview.findFirst({
    where: {
      jobId,
      deletedAt: null,
      counterPdfKey: { not: null },
      counterGeneratedAt: { gte: COUNTER_POSTING_STARTED },
    },
    orderBy: { counterGeneratedAt: 'desc' },
    select: {
      id: true,
      jobId: true,
      originalFilename: true,
      counterPdfKey: true,
      counterPdfUrl: true,
      counterGeneratedAt: true,
    },
  })
}

/**
 * The job's counter-proposal while it is still OPEN — posted, and the
 * negotiated agreement not yet out. Closed once the agreement it was accepted
 * onto (on ANY order of the job) is NEGOTIATED_READY or signed. While open,
 * the portal shows "Our response to your redline" and the standard agreement
 * is not signable (Wes 2026-09-15).
 */
export async function openCounterProposalForJob(jobId: string) {
  const review = await latestCounterProposalForJob(jobId)
  if (!review) return null
  const linked = await prisma.signedAgreement.findFirst({
    where: { contractReviewId: review.id },
    select: { status: true, signedAt: true },
  })
  const closed =
    !!linked &&
    (linked.status === 'NEGOTIATED_READY' ||
      linked.status === 'SIGNED_NEGOTIATED' ||
      linked.status === 'SIGNED_BASELINE' ||
      linked.status === 'SIGNED_OFFLINE' ||
      !!linked.signedAt)
  return closed ? null : review
}

/** Filename the client sees, on the portal and as the email attachment. */
export function counterProposalFilename(jobCode: string | null | undefined): string {
  const code = (jobCode || '').replace(/[^A-Za-z0-9-]+/g, '')
  return code ? `SirReel-counter-proposal-${code}.pdf` : 'SirReel-counter-proposal.pdf'
}

/** The PDF bytes, for an email attachment. Null when the blob is gone. */
export async function readCounterProposalBytes(counterPdfKey: string): Promise<Buffer | null> {
  const blob = await get(counterPdfKey, { access: 'private' })
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null
  const chunks: Uint8Array[] = []
  const reader = blob.stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}
