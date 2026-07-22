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

export interface SavedCard {
  /** CardSecure token — server-only, charge input. Never send to client. */
  cardToken: string
  /** Last 4 for display / audit trail. */
  last4: string | null
  cardType: string | null
  cardholderName: string | null
  authSignedAt: Date | null
  /** The paperwork_requests row the token came from. */
  paperworkRequestId: string
}

export async function resolveSavedCardForInvoice(
  invoiceId: string,
): Promise<SavedCard | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, order: { select: { bookingId: true } } },
  })
  const bookingId = invoice?.order?.bookingId
  if (!bookingId) return null

  // Latest paperwork row for this booking that carries a CC token.
  const pw = await prisma.paperworkRequest.findFirst({
    where: {
      bookingId,
      creditCardAuth: true,
      ccCardNumberEncrypted: { not: null },
    },
    orderBy: [{ ccAuthSignedAt: 'desc' }, { sentAt: 'desc' }],
    select: {
      id: true,
      ccCardNumberEncrypted: true,
      ccCardLast4: true,
      ccCardType: true,
      ccCardholderFirst: true,
      ccCardholderLast: true,
      ccAuthSignedAt: true,
    },
  })
  if (!pw || !pw.ccCardNumberEncrypted) return null

  const cardholderName =
    [pw.ccCardholderFirst, pw.ccCardholderLast].filter(Boolean).join(' ').trim() || null

  return {
    cardToken: pw.ccCardNumberEncrypted,
    last4: pw.ccCardLast4 ?? null,
    cardType: pw.ccCardType ?? null,
    cardholderName,
    authSignedAt: pw.ccAuthSignedAt ?? null,
    paperworkRequestId: pw.id,
  }
}
