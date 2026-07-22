/**
 * recordPayment / voidPayment — Phase 5 commit 3, full native order-to-cash.
 *
 * Atomic flow on record:
 *   1. Validate the invoice exists, is non-VOID, and the amount fits
 *      the current balanceDue (no overpayment without explicit flag).
 *   2. Insert Payment row.
 *   3. Recompute Invoice.amountPaid + balanceDue from the non-voided
 *      payment sum (single source of truth — never increment in
 *      place; recompute makes void/unvoid trivial and idempotent).
 *   4. Transition Invoice.status:
 *        SENT  → PARTIAL when 0 < paid < total
 *        any   → PAID when paid >= total (stamps paidAt)
 *   5. When the invoice flips to PAID AND it's a RENTAL invoice AND
 *      the order is currently INVOICED, advance Order → CLOSED.
 *      Non-blocking on L&D per doctrine: an open LD invoice / claim
 *      never gates the rental arc's close.
 *
 * Symmetric undo on void:
 *   - Stamps voidedAt/voidedById/voidReason.
 *   - Recomputes the invoice the same way (Payment SUM where
 *     voidedAt IS NULL).
 *   - May regress Invoice.status: PAID → PARTIAL/SENT, PARTIAL → SENT.
 *     Regresses Order CLOSED → INVOICED iff this invoice was the one
 *     that drove the close (RENTAL + previously fully paid). Guarded
 *     against past states — never regresses past INVOICED.
 *
 * Forward-only at the order level when nothing voids — the rental
 * arc moves forward through INVOICED → CLOSED and back-and-forth
 * regression is only allowed through explicit void.
 *
 * READ-ONLY against Order.booked* — never written.
 */

import type { PaymentMethod } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export interface PaymentInput {
  invoiceId: string
  amount: number
  method: PaymentMethod
  receivedAt: Date
  reference?: string | null
  notes?: string | null
  recordedById: string
  /** CardConnect retref for gateway-settled operator charges (e.g. the
   *  charge-saved-card flow). Persisted on Payment.gatewayRefId for
   *  reconciliation / void. Null for manually-keyed cash/check/wire. */
  gatewayRefId?: string | null
  /** Card processing surcharge charged ON TOP of `amount` at the gateway.
   *  `amount` credits the invoice; the gateway charged amount+surcharge.
   *  Null for non-surcharged payments. */
  surchargeAmount?: number | null
  /** When true, allow overpayment (amount > balanceDue). Default false
   *  — operators should record exact amounts. Keep the flag for the
   *  future case of credit notations. */
  allowOverpay?: boolean
}

export type RecordPaymentResult =
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

export type VoidPaymentResult =
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
      orderRegressedFromClosed: boolean
    }
  | { ok: false; status: number; error: string }

// ─── Record ─────────────────────────────────────────────────────
export async function recordPayment(input: PaymentInput): Promise<RecordPaymentResult> {
  const { invoiceId, amount, method, receivedAt, reference = null, notes = null, recordedById, gatewayRefId = null, surchargeAmount = null, allowOverpay = false } = input

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, error: 'amount must be > 0' }
  }
  if (amount > 1_000_000) {
    return { ok: false, status: 400, error: 'amount looks implausibly large' }
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      type: true,
      total: true,
      balanceDue: true,
      orderId: true,
      order: { select: { status: true } },
    },
  })
  if (!invoice) return { ok: false, status: 404, error: 'invoice not found' }
  if (invoice.status === 'VOID') return { ok: false, status: 409, error: 'cannot record payment against a voided invoice' }
  if (invoice.status === 'DRAFT') return { ok: false, status: 409, error: 'send the invoice before recording payment' }

  const balanceDue = Number(invoice.balanceDue)
  if (!allowOverpay && amount > balanceDue + 0.001) {
    return {
      ok: false,
      status: 409,
      error: `amount $${amount.toFixed(2)} exceeds balance due $${balanceDue.toFixed(2)}`,
    }
  }

  // Idempotency for gateway-settled charges: a CardConnect retref is
  // unique, so if we've already recorded a Payment for it, don't double-
  // write. Only applies when gatewayRefId is set (cash/check leave it
  // null and are never deduped this way).
  if (gatewayRefId) {
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
  }

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        invoiceId,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        method,
        receivedAt,
        reference,
        notes,
        recordedById,
        gatewayRefId,
        surchargeAmount:
          surchargeAmount != null && surchargeAmount > 0
            ? new Prisma.Decimal(surchargeAmount.toFixed(2))
            : null,
      },
      select: { id: true },
    })
    const updated = await reconcileInvoiceTotals(tx, invoiceId)
    const orderAdvancedToClosed = await maybeAdvanceOrderToClosed(tx, invoiceId, updated)
    await tx.auditLog.create({
      data: {
        userId: recordedById,
        action: 'payment.recorded',
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
          orderAdvancedToClosed,
        },
      },
    })
    return { paymentId: payment.id, invoice: updated, orderAdvancedToClosed }
  })

  return { ok: true, ...result }
}

// ─── Void ───────────────────────────────────────────────────────
export async function voidPayment(args: {
  paymentId: string
  voidedById: string
  reason: string
}): Promise<VoidPaymentResult> {
  const { paymentId, voidedById, reason } = args
  const trimmedReason = reason.trim()
  if (!trimmedReason || trimmedReason.length < 4) {
    return { ok: false, status: 400, error: 'void reason is required (≥4 chars)' }
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      invoiceId: true,
      amount: true,
      voidedAt: true,
      invoice: { select: { status: true, type: true, orderId: true, order: { select: { status: true } } } },
    },
  })
  if (!payment) return { ok: false, status: 404, error: 'payment not found' }
  if (payment.voidedAt) return { ok: false, status: 409, error: 'payment already voided' }

  const wasInvoicePaid = payment.invoice.status === 'PAID'

  const result = await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        voidedAt: new Date(),
        voidedById,
        voidReason: trimmedReason,
      },
    })
    const updated = await reconcileInvoiceTotals(tx, payment.invoiceId)
    const orderRegressedFromClosed = await maybeRegressOrderFromClosed(tx, payment.invoiceId, updated, wasInvoicePaid)
    await tx.auditLog.create({
      data: {
        userId: voidedById,
        action: 'payment.voided',
        entityType: 'Payment',
        entityId: payment.id,
        oldValues: {
          invoiceStatus: payment.invoice.status,
          amount: Number(payment.amount).toFixed(2),
        },
        newValues: {
          invoiceStatus: updated.status,
          invoiceBalanceDue: updated.balanceDue,
          invoiceAmountPaid: updated.amountPaid,
          reason: trimmedReason,
          orderRegressedFromClosed,
        },
      },
    })
    return { paymentId, invoice: updated, orderRegressedFromClosed }
  })

  return { ok: true, ...result }
}

// ─── Helpers ────────────────────────────────────────────────────
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/**
 * Recomputes Invoice.amountPaid + balanceDue from the CLEARED, non-
 * voided payment sum and updates the status accordingly. Returns the
 * new shape so the caller can avoid a re-read.
 *
 * Phase 6 LINCHPIN: only PaymentStatus = CLEARED counts toward paid.
 * PENDING and SETTLED ACH originations do NOT mark an invoice paid
 * and do NOT advance the order to CLOSED. RETURNED and FAILED are
 * also excluded — those are bank-rejected / gateway-declined and
 * never collected. Card auth+capture writes CLEARED immediately;
 * ACH walks through PENDING → SETTLED → CLEARED via the polling job.
 */
export async function reconcileInvoiceTotals(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, total: true, status: true, paidAt: true },
  })
  if (!inv) throw new Error('reconcileInvoiceTotals: invoice vanished mid-tx')

  const agg = await tx.payment.aggregate({
    where: { invoiceId, voidedAt: null, status: 'CLEARED' },
    _sum: { amount: true },
  })
  const total = Number(inv.total)
  const paid = Number(agg._sum.amount ?? 0)
  const balance = Math.max(0, Math.round((total - paid) * 100) / 100)

  // Compute new status. Don't touch DRAFT or VOID — those are governed
  // elsewhere. Otherwise:
  //   paid >= total       → PAID
  //   0 < paid < total    → PARTIAL
  //   paid <= 0           → SENT (the previous post-DRAFT default)
  let nextStatus = inv.status
  let nextPaidAt = inv.paidAt
  if (inv.status !== 'DRAFT' && inv.status !== 'VOID') {
    if (paid + 0.005 >= total) {
      nextStatus = 'PAID'
      if (nextPaidAt == null) nextPaidAt = new Date()
    } else if (paid > 0) {
      nextStatus = 'PARTIAL'
      // PAID → PARTIAL regression clears paidAt so the cycle is honest.
      if (inv.status === 'PAID') nextPaidAt = null
    } else {
      nextStatus = 'SENT'
      if (inv.status === 'PAID') nextPaidAt = null
    }
  }

  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: new Prisma.Decimal(paid.toFixed(2)),
      balanceDue: new Prisma.Decimal(balance.toFixed(2)),
      status: nextStatus,
      paidAt: nextPaidAt,
    },
  })

  return {
    id: invoiceId,
    status: nextStatus,
    amountPaid: paid.toFixed(2),
    balanceDue: balance.toFixed(2),
    paidAt: nextPaidAt,
  }
}

/** Advances Order INVOICED → CLOSED iff the touched invoice is a
 *  fully-paid RENTAL. Non-blocking on LD per doctrine — open LD
 *  invoices and claims never gate this. */
export async function maybeAdvanceOrderToClosed(
  tx: Tx,
  invoiceId: string,
  updated: { status: string },
): Promise<boolean> {
  if (updated.status !== 'PAID') return false
  const inv = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { type: true, orderId: true, order: { select: { status: true } } },
  })
  if (!inv) return false
  if (inv.type !== 'RENTAL') return false
  if (inv.order.status !== 'INVOICED') return false
  await tx.order.update({
    where: { id: inv.orderId },
    data: { status: 'CLOSED' },
  })
  await tx.auditLog.create({
    data: {
      action: 'order.closed',
      entityType: 'Order',
      entityId: inv.orderId,
      oldValues: { status: 'INVOICED' },
      newValues: {
        status: 'CLOSED',
        triggeredBy: 'invoice.paid',
        invoiceId,
      },
    },
  })
  return true
}

/** Regresses Order CLOSED → INVOICED iff voiding a payment dropped
 *  the RENTAL invoice off PAID and the order is currently CLOSED.
 *  Forward states (none past CLOSED in the rental arc) are guarded:
 *  this never moves an order off CANCELLED, etc. */
export async function maybeRegressOrderFromClosed(
  tx: Tx,
  invoiceId: string,
  updated: { status: string },
  wasInvoicePaid: boolean,
): Promise<boolean> {
  if (!wasInvoicePaid) return false
  if (updated.status === 'PAID') return false
  const inv = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { type: true, orderId: true, order: { select: { status: true } } },
  })
  if (!inv) return false
  if (inv.type !== 'RENTAL') return false
  if (inv.order.status !== 'CLOSED') return false
  await tx.order.update({
    where: { id: inv.orderId },
    data: { status: 'INVOICED' },
  })
  await tx.auditLog.create({
    data: {
      action: 'order.closed.undo',
      entityType: 'Order',
      entityId: inv.orderId,
      oldValues: { status: 'CLOSED' },
      newValues: {
        status: 'INVOICED',
        triggeredBy: 'payment.voided',
        invoiceId,
      },
    },
  })
  return true
}
