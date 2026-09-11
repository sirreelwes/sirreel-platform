/**
 * Mirror a gateway reversal onto the Payment a collections charge recorded
 * on an HQ-native invoice.
 *
 * A charge anchored `hq:<invoiceId>` credited a real Payment (see
 * /api/collections/charge), so money coming back off the card has to come
 * off the invoice too — otherwise it reads PAID with a refunded card behind
 * it, and the stamped PDF says so to the client.
 *
 * The live Payment for a charge is the un-voided one carrying the charge's
 * retref — after an earlier partial it is the replacement, which carries the
 * same retref on purpose. Full reversal: void it (recordPayment's void
 * regresses the invoice and reopens a CLOSED order). Partial: void it and
 * re-record what the invoice keeps, so the invoice's own arithmetic
 * (amountPaid = SUM of live payments) stays a plain sum and the audit trail
 * shows the refund as a void + a smaller payment rather than a negative
 * row, which Payment forbids.
 *
 * The refunded GROSS carries a fee slice — the gateway refunds the surcharge
 * pro rata — and only the base part ever credited the invoice, so that is
 * what comes off it.
 *
 * In lib rather than the route so it can be exercised without a gateway:
 * the UAT sandbox refuses a partial refund until the charge settles, which
 * is never within one verification run.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { voidPayment, reconcileInvoiceTotals } from '@/lib/invoices/recordPayment'

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** The base share of a refunded gross, given the charge's base : fee split. */
export function refundedBaseOf(reversedGross: number, chargeBase: number, chargeFee: number): number {
  const gross = chargeBase + chargeFee
  return gross > 0 ? round(reversedGross * (chargeBase / gross)) : round(reversedGross)
}

export async function adjustHqPayment(args: {
  invoiceId: string
  retref: string
  chargeBase: number
  chargeFee: number
  reversedGross: number
  fullyReversed: boolean
  reason: string
  userId: string
}): Promise<{ status: string; amountPaid: string; balanceDue: string } | null> {
  const live = await prisma.payment.findFirst({
    where: { invoiceId: args.invoiceId, gatewayRefId: args.retref, voidedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, amount: true, surchargeAmount: true, method: true, reference: true, receivedAt: true },
  })
  if (!live) return null

  const voided = await voidPayment({
    paymentId: live.id,
    voidedById: args.userId,
    reason: `collections ${args.fullyReversed ? 'reversal' : 'partial refund'}: ${args.reason}`,
  })
  if (!voided.ok) {
    console.error('[collections] could not void payment %s after reversal: %s', live.id, voided.error)
    return null
  }
  if (args.fullyReversed) return voided.invoice

  const refundedBase = refundedBaseOf(args.reversedGross, args.chargeBase, args.chargeFee)
  const keepBase = round(Number(live.amount) - refundedBase)
  const keepFee = round(Number(live.surchargeAmount ?? 0) - (args.reversedGross - refundedBase))
  if (keepBase <= 0) return voided.invoice

  return prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        invoiceId: args.invoiceId,
        amount: new Prisma.Decimal(keepBase.toFixed(2)),
        method: live.method,
        receivedAt: live.receivedAt,
        reference: `${live.reference ?? 'card'} · after $${refundedBase.toFixed(2)} refund`,
        notes: `Replaces the voided payment after a partial refund: ${args.reason}`,
        recordedById: args.userId,
        gatewayRefId: args.retref,
        surchargeAmount: keepFee > 0 ? new Prisma.Decimal(keepFee.toFixed(2)) : null,
      },
    })
    return reconcileInvoiceTotals(tx, args.invoiceId)
  })
}
