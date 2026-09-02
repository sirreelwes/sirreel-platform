import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normalizePaymentPreference } from '@/lib/payments/paymentPreference'
import { requireCollectionsUser } from '@/lib/collections/access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/collections/authorizations — every credit-card authorization on
 * file that can actually be charged, newest first.
 *
 * "Can be charged" means it holds a CardSecure token. An authorization the
 * client started but never completed has no token, and listing it would
 * offer Ana a charge button that cannot work.
 *
 * NEVER returns the token. Only display fields go to the browser; the charge
 * endpoint takes the paperwork id and resolves the token server-side, so a
 * stored card can't be lifted out of a response.
 *
 * Expect this list to be EMPTY today — the portal CC-authorization step has
 * never captured a record in production (0 rows as of Aug 2026). Historical
 * authorizations live in Cognito Forms as raw card numbers, which are
 * deliberately NOT migrated here: tokenizing them would mean handling PANs
 * and pulling SirReel into PCI scope. This list fills from the next portal
 * authorization onward; until then, collections uses the phone-key path.
 */

export async function GET() {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const rows = await prisma.paperworkRequest.findMany({
    where: { ccCardNumberEncrypted: { not: null } },
    orderBy: [{ ccAuthSignedAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      ccCardholderFirst: true,
      ccCardholderLast: true,
      ccCardType: true,
      ccCardLast4: true,
      ccAuthSignedAt: true,
      ccPaymentPreference: true,
      booking: {
        select: {
          id: true,
          job: { select: { id: true, name: true, jobCode: true } },
          // A booking can carry several orders; take the first for display.
          // The rental agreement hangs off the ORDER, and it is the document
          // that makes the authorization enforceable — surfaced so Ana can
          // see the paperwork before charging rather than hunting for it.
          orders: {
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: {
              orderNumber: true,
              job: { select: { id: true, name: true, jobCode: true } },
              signedAgreements: {
                where: { contractType: 'RENTAL_AGREEMENT' },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { id: true, status: true, signedAt: true, signedDocumentUrl: true },
              },
            },
          },
        },
      },
    },
  })

  const authorizations = rows.map((r) => {
    const order = r.booking?.orders?.[0] ?? null
    const agreement = order?.signedAgreements?.[0] ?? null
    // Booking.job is the newer direct FK; legacy Planyo bookings only reach a
    // Job through their Order. Prefer the direct one, fall back.
    const job = r.booking?.job ?? order?.job ?? null
    return {
      id: r.id,
      cardholderName:
        [r.ccCardholderFirst, r.ccCardholderLast].filter(Boolean).join(' ') || null,
      cardType: r.ccCardType,
      last4: r.ccCardLast4,
      authorizedAt: r.ccAuthSignedAt,
      // 'CHECK_WIRE' means the client intends to pay by check and the card is
      // security only; 'UNDECIDED' means they have not chosen yet. Both are
      // still chargeable — surfaced so Ana knows she is going against (or
      // ahead of) their stated preference before she does it.
      paymentPreference: normalizePaymentPreference(r.ccPaymentPreference) ?? 'CARD',
      jobId: job?.id ?? null,
      jobName: job?.name ?? null,
      jobCode: job?.jobCode ?? null,
      orderNumber: order?.orderNumber ?? null,
      rentalAgreement: agreement
        ? {
            status: agreement.status,
            signedAt: agreement.signedAt,
            signedDocumentUrl: agreement.signedDocumentUrl,
          }
        : null,
    }
  })

  return NextResponse.json({ ok: true, authorizations })
}
