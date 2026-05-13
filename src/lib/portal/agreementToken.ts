import { prisma } from '@/lib/prisma'

/**
 * Resolve a paperwork-portal magic-link token to the Order + SignedAgreement
 * that should drive the agreement signing UI for that link.
 *
 * The current portal magic link lives on `PaperworkRequest` and is keyed to a
 * `Booking`, while `SignedAgreement` is 1:1 with `Order`. A booking can in
 * principle have multiple orders, but the paperwork portal is single-order
 * per visit, so we resolve to the first order on the booking (oldest = most
 * canonical). When a real multi-order workflow lands, this resolver becomes
 * the one place to revisit.
 *
 * Returns null on invalid/expired token. Returns the SignedAgreement as null
 * (with order present) when no record exists yet — callers that need the
 * record can fall back to `ensureSignedAgreementForOrder`.
 */
export interface ResolvedAgreementToken {
  token: string
  bookingId: string
  order: {
    id: string
    orderNumber: string
    startDate: Date | null
    endDate: Date | null
    company: { id: string; name: string }
    job: { id: string; jobCode: string; name: string } | null
  }
  agreement: {
    id: string
    status: import('@prisma/client').AgreementStatus
    documentType: import('@prisma/client').AgreementDocumentType
    documentToSignUrl: string | null
    wordDocumentUrl: string | null
    signedDocumentUrl: string | null
    signedAt: Date | null
    signerName: string | null
  } | null
}

export async function resolveAgreementToken(
  token: string,
): Promise<ResolvedAgreementToken | null> {
  if (!token || typeof token !== 'string') return null

  const request = await prisma.paperworkRequest.findUnique({
    where: { token },
    select: { bookingId: true },
  })
  if (!request) return null

  const order = await prisma.order.findFirst({
    where: { bookingId: request.bookingId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      orderNumber: true,
      startDate: true,
      endDate: true,
      company: { select: { id: true, name: true } },
      job: { select: { id: true, jobCode: true, name: true } },
      signedAgreement: {
        select: {
          id: true,
          status: true,
          documentType: true,
          documentToSignUrl: true,
          wordDocumentUrl: true,
          signedDocumentUrl: true,
          signedAt: true,
          signerName: true,
        },
      },
    },
  })
  if (!order) return null

  return {
    token,
    bookingId: request.bookingId,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      startDate: order.startDate,
      endDate: order.endDate,
      company: order.company,
      job: order.job,
    },
    agreement: order.signedAgreement,
  }
}
