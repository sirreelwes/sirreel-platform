/**
 * resolveSavedCardForInvoice — find the card-on-file authorization that
 * can be charged for a given invoice.
 *
 * The stored card token lives on paperwork_requests (captured by the
 * portal CC-authorization step — see /api/portal/[token]/sign step 'cc'),
 * keyed to a Booking. An invoice reaches it through:
 *
 *     Invoice → Order.bookingId → Booking → PaperworkRequest
 *
 * We return the MOST RECENTLY AUTHORIZED paperwork row for that booking
 * that actually holds a CardSecure token. If any link in the chain is
 * missing (order has no booking, no CC auth on file), we return null and
 * the charge affordance simply isn't offered for that invoice.
 *
 * The token itself (`cardToken`) is a CardSecure token, NOT a PAN — safe
 * to hand to chargeCard(). It is NEVER returned to the browser; only the
 * display fields (last4, cardholder, type) are surfaced by the API.
 */

import { prisma } from '@/lib/prisma'
import { resolveCompanyDefaultCard } from '@/lib/payments/companyCards'
import { normalizePaymentPreference, type PaymentPreference } from '@/lib/payments/paymentPreference'

export interface SavedCard {
  /** CardSecure token — server-only, charge input. Never send to client. */
  cardToken: string
  /** Last 4 for display / audit trail. */
  last4: string | null
  cardType: string | null
  /** MMYY, captured with the authorization. Required on every auth. */
  expiry: string | null
  /** Cardholder billing postal, captured with the authorization. The gateway
   *  needs it to decide surcharge eligibility on card-not-present charges. */
  postal: string | null
  cardholderName: string | null
  authSignedAt: Date | null
  /** Client's stated payment intent: 'CARD' (charge the card) or
   *  'CHECK_WIRE' (client pays by check/bank transfer, card is security
   *  only). Null = legacy/unspecified (treat as CARD). Informational —
   *  the card is chargeable regardless. */
  paymentPreference: PaymentPreference | null
  /** The paperwork_requests row the token came from, when it came from one. */
  paperworkRequestId: string | null
  /** The company-wallet row the token came from, when it came from one. */
  companyCardId?: string | null
  /** Staff-set nickname, when the card is a wallet card. */
  label?: string | null
}

export async function resolveSavedCardForInvoice(
  invoiceId: string,
): Promise<SavedCard | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, order: { select: { bookingId: true, jobId: true, companyId: true } } },
  })
  if (!invoice?.order) return null

  // ── The company's wallet first ───────────────────────────────────
  //
  // A company that keeps more than one card on file has told us which one to
  // charge (Wes, 2026-09-01). Honouring that beats any date-ordered guess
  // across paperwork rows — charging the wrong card of two is a call from
  // the client's accounting department, not a UI defect.
  //
  // Only an EXPLICIT default short-circuits. A wallet with cards but no
  // default falls through: with two cards and no instruction, picking one is
  // the same guess this exists to remove, and the legacy path at least
  // resolves the card that was authorized for this booking.
  if (invoice.order.companyId) {
    const walletCard = await resolveCompanyDefaultCard(invoice.order.companyId)
    if (walletCard) {
      return {
        cardToken: walletCard.cardToken,
        last4: walletCard.last4,
        cardType: walletCard.cardType,
        expiry: walletCard.expiry,
        postal: walletCard.postal,
        cardholderName: walletCard.cardholderName,
        authSignedAt: walletCard.authorizedAt,
        paymentPreference: walletCard.paymentPreference,
        paperworkRequestId: walletCard.paperworkRequestId,
        companyCardId: walletCard.companyCardId,
        label: walletCard.label,
      }
    }
  }

  // ── Which bookings might hold the card ─────────────────────────────
  //
  // The order's own bookingId first, then every booking on its JOB.
  //
  // Wes, 2026-09-01: "the dreambear team was unable to pay via hq payment
  // options." Their card WAS on file — VISA ····7654, authorized through
  // the portal on 2026-08-25 — but it hangs off the job's booking
  // (SR-2026-0204) while order S260825-002 carries bookingId NULL. This
  // resolver read only the order's own link, returned null, and the
  // charge-a-card-on-file path reported hasCard:false. Staff could not
  // charge a card the client had already given them.
  //
  // Not a one-off: measured that day, of every order carrying an invoice,
  // ZERO had bookingId set. The Job is the root the booking hangs from
  // (Job-as-root, 2026-08), so the job is where the card actually lives.
  const bookingIds = new Set<string>()
  if (invoice.order.bookingId) bookingIds.add(invoice.order.bookingId)
  if (invoice.order.jobId) {
    const jobBookings = await prisma.booking.findMany({
      where: { jobId: invoice.order.jobId },
      select: { id: true },
    })
    jobBookings.forEach((b) => bookingIds.add(b.id))
  }
  if (bookingIds.size === 0) return null

  // Latest paperwork row across those bookings that carries a CC token.
  const pw = await prisma.paperworkRequest.findFirst({
    where: {
      bookingId: { in: [...bookingIds] },
      creditCardAuth: true,
      ccCardNumberEncrypted: { not: null },
    },
    orderBy: [{ ccAuthSignedAt: 'desc' }, { sentAt: 'desc' }],
    select: {
      id: true,
      ccCardNumberEncrypted: true,
      ccCardLast4: true,
      ccCardType: true,
      ccCardExpiry: true,
      ccBillingPostal: true,
      ccCardholderFirst: true,
      ccCardholderLast: true,
      ccAuthSignedAt: true,
      ccPaymentPreference: true,
    },
  })
  if (!pw || !pw.ccCardNumberEncrypted) return null

  const cardholderName =
    [pw.ccCardholderFirst, pw.ccCardholderLast].filter(Boolean).join(' ').trim() || null

  return {
    cardToken: pw.ccCardNumberEncrypted,
    last4: pw.ccCardLast4 ?? null,
    cardType: pw.ccCardType ?? null,
    expiry: pw.ccCardExpiry ?? null,
    postal: pw.ccBillingPostal ?? null,
    cardholderName,
    authSignedAt: pw.ccAuthSignedAt ?? null,
    paymentPreference: normalizePaymentPreference(pw.ccPaymentPreference),
    paperworkRequestId: pw.id,
  }
}
