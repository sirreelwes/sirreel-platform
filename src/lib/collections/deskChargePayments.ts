/**
 * One card charge on an HQ invoice is TWO rows, and the desk must count it once.
 *
 * /api/collections/charge writes the `RwCollectionCharge` ledger row for every
 * charge, and when the invoice is HQ-native (anchored `hq:<invoiceId>`) it also
 * records a `Payment` on that invoice carrying the gateway retref. The desk
 * activity page summed both — the card bucket and the HQ bucket — so every
 * desk charge on an HQ invoice read double. Found 2026-09-15: MITU NGL, LLC,
 * SR-INV-30022, $360, as a charge at 2026-09-14T19:46:46.740Z and a Payment
 * 121ms later; Creative Riff SR-INV-30015 ($1,504, 9/11) was the same — $1,864
 * of the 30-day HQ bucket was card money already counted.
 *
 * The CHARGE is the row that stays. It is what the desk did (a card taken, by
 * `chargedById`, credited as "charged" in the operator table), it counts toward
 * invoices closed, and it survives a failed Payment write — the route charges
 * the card first, so a charge with no Payment behind it is still money in. The
 * Payment is the echo, and is dropped.
 *
 * Matched the way the reversal path finds it (hqChargeReversal.ts): same
 * invoice, same retref. Only a charge that still counts as collected hides its
 * echo. A partially refunded charge stops counting (`reversedAt` is stamped on
 * partials too) and its replacement Payment — same retref, the base the invoice
 * kept — is then the only place that money shows, so it must NOT be hidden. A
 * fully reversed charge's Payment is voided and never reaches here.
 *
 * Pure so it can be tested without a database: npm run test:desk-charge-payments
 */

export interface DeskChargeLike {
  rwInvoiceId: string
  retref: string | null
  status: string
  reversedAt: Date | null
}

export interface DeskPaymentLike {
  id: string
  invoiceId: string
  gatewayRefId: string | null
}

/** A charge that is money in: approved at the gateway, and nothing handed back. */
export function chargeCountsAsCollected(c: Pick<DeskChargeLike, 'status' | 'reversedAt'>): boolean {
  return c.status === 'APPROVED' && !c.reversedAt
}

const HQ_ANCHOR = 'hq:'

/**
 * Ids of the Payments that are only the HQ-invoice side of a desk charge
 * already counted. A retref-less row matches nothing — without the gateway id
 * there is no proof the two rows are the same money, and dropping a real
 * payment is worse than showing one twice.
 */
export function paymentsEchoingDeskCharges(
  charges: readonly DeskChargeLike[],
  payments: readonly DeskPaymentLike[],
): Set<string> {
  const keys = new Set<string>()
  for (const c of charges) {
    if (!c.rwInvoiceId.startsWith(HQ_ANCHOR) || !c.retref || !chargeCountsAsCollected(c)) continue
    keys.add(`${c.rwInvoiceId.slice(HQ_ANCHOR.length)}|${c.retref}`)
  }
  const echoed = new Set<string>()
  for (const p of payments) {
    if (p.gatewayRefId && keys.has(`${p.invoiceId}|${p.gatewayRefId}`)) echoed.add(p.id)
  }
  return echoed
}
