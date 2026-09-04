import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normalizePaymentPreference } from '@/lib/payments/paymentPreference'
import { isExpiryPast } from '@/lib/payments/companyCards'
import { requireCollectionsUser } from '@/lib/collections/access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/collections/authorizations — every card on file that collections
 * can actually charge, newest first, each carrying the CLIENT it belongs to.
 *
 * "Can be charged" means it holds a CardSecure token. An authorization the
 * client started but never completed has no token, and listing it would
 * offer Ana a charge button that cannot work.
 *
 * NEVER returns the token. Only display fields go to the browser; the charge
 * endpoint takes a card id + origin and resolves the token server-side, so a
 * stored card can't be lifted out of a response.
 *
 * TWO SOURCES, and for a year this route only read one of them:
 *
 *   company   — the CompanyCard wallet: cards a client saved in the portal
 *               and cards staff keyed from a signed authorization. This is
 *               where every card added since the wallet shipped has landed.
 *   paperwork — the legacy per-booking PaperworkRequest authorization.
 *
 * Ana, 2026-09-04: "I only see 7 cards on file, and none of them are for the
 * company I'm charging out for." Both halves of that were this route: it
 * listed paperwork rows ONLY, so the entire wallet was invisible here, and it
 * carried no company at all, so the picker could not tell whose card was
 * whose. A flat list of other clients' cards is not just unhelpful — it is
 * how a charge lands on the wrong production's card.
 */

interface CardRow {
  id: string
  origin: 'company' | 'paperwork'
  cardholderName: string | null
  cardType: string | null
  last4: string | null
  expiry: string | null
  /** MM/YY already past. The gateway still decides, but staff should see it. */
  expired: boolean
  /** Wallet cards only — the client's own name for the card ("AmEx — gear"). */
  label: string | null
  isDefault: boolean
  authorizedAt: Date | null
  /** The $0 stored-credential check came back approved. */
  validated: boolean
  paymentPreference: string
  companyId: string | null
  companyName: string | null
  jobId: string | null
  jobName: string | null
  jobCode: string | null
  orderNumber: string | null
  rentalAgreement: { status: string; signedAt: Date | null; signedDocumentUrl: string | null } | null
}

export async function GET() {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const now = new Date()

  const [wallet, paperwork] = await Promise.all([
    prisma.companyCard.findMany({
      where: { removedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      select: {
        id: true,
        cardToken: true,
        label: true,
        last4: true,
        cardType: true,
        expiry: true,
        cardholderName: true,
        isDefault: true,
        paymentPreference: true,
        authValidatedAt: true,
        authRespStat: true,
        createdAt: true,
        company: { select: { id: true, name: true } },
      },
    }),
    prisma.paperworkRequest.findMany({
      where: { ccCardNumberEncrypted: { not: null } },
      orderBy: [{ ccAuthSignedAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        ccCardNumberEncrypted: true,
        ccCardholderFirst: true,
        ccCardholderLast: true,
        ccCardType: true,
        ccCardLast4: true,
        ccCardExpiry: true,
        ccAuthSignedAt: true,
        ccPaymentPreference: true,
        ccAuthRespStat: true,
        ccAuthValidatedAt: true,
        booking: {
          select: {
            id: true,
            job: { select: { id: true, name: true, jobCode: true, company: { select: { id: true, name: true } } } },
            // A booking can carry several orders; take the first for display.
            // The rental agreement hangs off the ORDER, and it is the document
            // that makes the authorization enforceable — surfaced so Ana can
            // see the paperwork before charging rather than hunting for it.
            orders: {
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: {
                orderNumber: true,
                job: {
                  select: {
                    id: true,
                    name: true,
                    jobCode: true,
                    company: { select: { id: true, name: true } },
                  },
                },
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
    }),
  ])

  // A card migrated into the wallet still sits on its paperwork row. Dedupe on
  // the token so the same card isn't offered twice under two ids — the wallet
  // copy wins, because that is the one with a company on it.
  const walletTokens = new Set(wallet.map((c) => c.cardToken))

  const walletRows: CardRow[] = wallet.map((c) => ({
    id: c.id,
    origin: 'company',
    cardholderName: c.cardholderName,
    cardType: c.cardType,
    last4: c.last4,
    expiry: c.expiry,
    expired: isExpiryPast(c.expiry, now),
    label: c.label,
    isDefault: c.isDefault,
    authorizedAt: c.authValidatedAt ?? c.createdAt,
    validated: c.authRespStat === 'A',
    paymentPreference: normalizePaymentPreference(c.paymentPreference) ?? 'CARD',
    companyId: c.company?.id ?? null,
    companyName: c.company?.name ?? null,
    // Wallet cards belong to the ACCOUNT, not to one job — there is no single
    // job or agreement to point at, and inventing one would misdescribe what
    // the client authorized.
    jobId: null,
    jobName: null,
    jobCode: null,
    orderNumber: null,
    rentalAgreement: null,
  }))

  const paperworkRows: CardRow[] = paperwork
    .filter((r) => r.ccCardNumberEncrypted && !walletTokens.has(r.ccCardNumberEncrypted))
    .map((r) => {
      const order = r.booking?.orders?.[0] ?? null
      const agreement = order?.signedAgreements?.[0] ?? null
      // Booking.job is the newer direct FK; legacy Planyo bookings only reach a
      // Job through their Order. Prefer the direct one, fall back.
      const job = r.booking?.job ?? order?.job ?? null
      return {
        id: r.id,
        origin: 'paperwork' as const,
        cardholderName:
          [r.ccCardholderFirst, r.ccCardholderLast].filter(Boolean).join(' ') || null,
        cardType: r.ccCardType,
        last4: r.ccCardLast4,
        expiry: r.ccCardExpiry,
        expired: isExpiryPast(r.ccCardExpiry, now),
        label: null,
        isDefault: false,
        authorizedAt: r.ccAuthSignedAt,
        validated: r.ccAuthRespStat === 'A' || !!r.ccAuthValidatedAt,
        // 'CHECK_WIRE' means the client intends to pay by check and the card is
        // security only; 'UNDECIDED' means they have not chosen yet. Both are
        // still chargeable — surfaced so Ana knows she is going against (or
        // ahead of) their stated preference before she does it.
        paymentPreference: normalizePaymentPreference(r.ccPaymentPreference) ?? 'CARD',
        companyId: job?.company?.id ?? null,
        companyName: job?.company?.name ?? null,
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

  return NextResponse.json({ ok: true, authorizations: [...walletRows, ...paperworkRows] })
}
