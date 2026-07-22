/**
 * recordPortalPayment — portal-attributed sibling of recordPayment.
 *
 * Phase 6 commit 2 — used by the card pay endpoint and (commit 3)
 * the ACH originate endpoint. Same atomic shape as the operator
 * helper: validate → INSERT → reconcileInvoiceTotals →
 * maybeAdvanceOrderToClosed → AuditLog. All inside one tx.
 *
 * XOR enforcement: portal-initiated payments set
 * initiatedByPortalAccessId; the schema allows null recordedById but
 * exactly one of the two MUST be set. This helper enforces that
 * invariant at the application boundary.
 *
 * Status discriminator:
 *   - Card capture writes CLEARED (Phase 5 LINCHPIN counts only
 *     CLEARED). Stamps cleared_at = settled_at = now() since gateway
 *     auth+capture is instant.
 *   - ACH origination writes PENDING. clearedAt stays null; the
 *     polling job (commit 4) walks it forward to CLEARED or
 *     RETURNED.
 *
 * Voids regress the same way as operator payments — reuses the
 * exported reconcile + advance/regress helpers from recordPayment.ts.
 */

import type { PaymentMethod, PaymentStatus } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  reconcileInvoiceTotals,
  maybeAdvanceOrderToClosed,
} from './recordPayment'

export interface PortalPaymentInput {
  invoiceId: string
  portalAccessId: string
  amount: number
  method: PaymentMethod
  /** CLEARED for card auth+capture; PENDING for ACH origination. */
  status: PaymentStatus
  /** CardConnect retref. Always set on portal payments since they
   *  always flow through the gateway. */
  gatewayRefId: string
  /** Card processing surcharge charged ON TOP of `amount` at the gateway.
   *  `amount` credits the invoice; the gateway charged amount+surcharge. */
  surchargeAmount?: number | null
  receivedAt: Date
  /** ACH-only attestation. */
  nachaAuthSignatureData?: string | null
  nachaAuthText?: string | null
  nachaAuthSignedAt?: Date | null
  /** Free-text — typically the last4 of card or bank acct. Never the
   *  full PAN / account number. */
  reference?: string | null
  notes?: string | null
}

export type RecordPortalPaymentResult =
  | {
      ok: true
      paymentId: string
      invoice: {
        id: string
        status: 'SENT' | 'PARTIAL' | 'PAID' | 'DRAFT' | 'VOID'
        amountPaid: string
        balanceDue: string
        paidAt: Date | null
      }
      orderAdvancedToClosed: boolean
    }
  | { ok: false; status: number; error: string }

export async function recordPortalPayment(
  input: PortalPaymentInput,
): Promise<RecordPortalPaymentResult> {
  const {
    invoiceId,
    portalAccessId,
    amount,
    method,
    status,
    gatewayRefId,
    surchargeAmount = null,
    receivedAt,
    nachaAuthSignatureData = null,
    nachaAuthText = null,
    nachaAuthSignedAt = null,
    reference = null,
    notes = null,
  } = input

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, error: 'amount must be > 0' }
  }
  if (amount > 1_000_000) {
    return { ok: false, status: 400, error: 'amount looks implausibly large' }
  }
  if (!gatewayRefId) {
    return { ok: false, status: 400, error: 'gatewayRefId required for portal payment' }
  }

  // Idempotency: a CardConnect retref is unique. If we've already
  // recorded a Payment for it, return that row instead of double-
  // writing. Defends against a client retrying after a network blip
  // mid-response.
  const existing = await prisma.payment.findFirst({
    where: { gatewayRefId, invoiceId },
    select: { id: true },
  })
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: 'a payment for this gateway transaction already exists',
    }
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      type: true,
      balanceDue: true,
    },
  })
  if (!invoice) return { ok: false, status: 404, error: 'invoice not found' }
  if (invoice.status === 'VOID') {
    return { ok: false, status: 409, error: 'cannot record payment against a voided invoice' }
  }
  if (invoice.status === 'DRAFT') {
    return { ok: false, status: 409, error: 'invoice has not been sent yet' }
  }

  const balanceDue = Number(invoice.balanceDue)
  // Overpayment guard. Portal can't overpay — the form pre-fills with
  // balance due and disables submit if the typed amount exceeds it,
  // but defend at the API too.
  if (amount > balanceDue + 0.001) {
    return {
      ok: false,
      status: 409,
      error: `amount $${amount.toFixed(2)} exceeds balance due $${balanceDue.toFixed(2)}`,
    }
  }

  const settledAt = status === 'CLEARED' ? receivedAt : null
  const clearedAt = status === 'CLEARED' ? receivedAt : null

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        invoiceId,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        method,
        status,
        gatewayRefId,
        surchargeAmount:
          surchargeAmount != null && surchargeAmount > 0
            ? new Prisma.Decimal(surchargeAmount.toFixed(2))
            : null,
        receivedAt,
        settledAt,
        clearedAt,
        reference,
        notes,
        // XOR: portal payments never set recordedById.
        recordedById: null,
        initiatedByPortalAccessId: portalAccessId,
        nachaAuthSignatureData,
        nachaAuthText,
        nachaAuthSignedAt,
      },
      select: { id: true },
    })
    // Only CLEARED affects invoice totals. PENDING ACH rows update
    // nothing on the invoice — the polling job will reconcile when
    // the payment advances to CLEARED.
    const updated = await reconcileInvoiceTotals(tx, invoiceId)
    const orderAdvancedToClosed = await maybeAdvanceOrderToClosed(tx, invoiceId, updated)

    await tx.auditLog.create({
      data: {
        // Portal-attributed: AuditLog.userId stays null; the
        // initiated-by-portal trail lives on Payment row itself.
        action: 'payment.recorded.portal',
        entityType: 'Payment',
        entityId: payment.id,
        oldValues: {
          invoiceStatus: invoice.status,
          invoiceBalanceDue: balanceDue.toFixed(2),
        },
        newValues: {
          invoiceStatus: updated.status,
          invoiceBalanceDue: updated.balanceDue,
          invoiceAmountPaid: updated.amountPaid,
          amount: amount.toFixed(2),
          method,
          paymentStatus: status,
          gatewayRefId,
          portalAccessId,
          orderAdvancedToClosed,
        },
      },
    })
    return { paymentId: payment.id, invoice: updated, orderAdvancedToClosed }
  })

  return { ok: true, ...result }
}
