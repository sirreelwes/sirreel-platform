import { prisma } from '@/lib/prisma'

/**
 * Idempotently create the SignedAgreement record for an Order. Called when an
 * Order transitions to quoteStatus=SENT (which is when the paperwork-portal
 * magic link is generated). Returns the existing record if one already exists.
 *
 * The baselineVersion is stamped with the date the record is first created so
 * later audits can tell which canonical baseline the client originally saw.
 * Update the format if you adopt a richer version scheme (e.g., commit SHA).
 */
export async function ensureSignedAgreementForOrder(orderId: string): Promise<void> {
  const existing = await prisma.signedAgreement.findUnique({
    where: { orderId },
    select: { id: true },
  })
  if (existing) return

  const today = new Date().toISOString().slice(0, 10)
  await prisma.signedAgreement.create({
    data: {
      orderId,
      status: 'PORTAL_GENERATED',
      documentType: 'BASELINE',
      baselineVersion: today,
    },
  })
}
