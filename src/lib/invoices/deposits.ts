/**
 * Deposits — taking money before the job wraps.
 *
 * ── The problem ─────────────────────────────────────────────────────────
 * Jose negotiates money upfront: a deposit, or occasionally the whole
 * rental paid before anything leaves the yard. HQ had no way to accept it.
 * `Payment.invoiceId` is NOT nullable, so money cannot be taken against a
 * bare order — there must be an Invoice. But raising the RENTAL invoice
 * early is destructive, and not in the obvious "it's just a document" way:
 *
 *   - sendInvoice advances RETURNED -> INVOICED, and an INVOICED order is
 *     OFF the dispatch board (src/app/api/dispatch/route.ts). Julian stops
 *     seeing the pickup for a truck that has not gone out yet.
 *   - isOrderEditable() excludes INVOICED, so the rep can no longer add the
 *     extra day, the swapped vehicle, or the gear added on the truck.
 *   - a fully-paid RENTAL invoice then advances the order to CLOSED
 *     (maybeAdvanceOrderToClosed), so paying upfront would CLOSE a job that
 *     has not started.
 *
 * ── Why a new invoice type and not a flag ───────────────────────────────
 * All three behaviours above are already gated on `type === 'RENTAL'`. LD
 * invoices established that pattern: a real, payable invoice hanging off the
 * order that does not drive the rental lifecycle. A DEPOSIT is the same
 * shape, so it inherits every one of those guards for free rather than
 * adding a fourth condition to each of them. Nothing in this file has to
 * teach sendInvoice or recordPayment about deposits — they already ignore
 * anything that is not RENTAL.
 *
 * ── How it settles ──────────────────────────────────────────────────────
 * The final rental invoice carries a DEPOSIT_CREDIT snapshot line for what
 * was already collected, so its balance is what is genuinely still owed.
 *
 * The credit is a LINE, not a seeded `Invoice.amountPaid`. amountPaid is
 * recomputed from Payment rows every time one is recorded or voided
 * (recomputeInvoiceTotals), so a seeded value would silently vanish the
 * first time Ana recorded the balance payment — the client would be re-
 * billed for the deposit and nothing would look wrong. Keeping each Payment
 * attached to the document it was actually made against is also what makes
 * the AR sum correct: deposit invoice $2,145 paid, final invoice $4,290 less
 * $2,145 credit = $2,145 owed. Nothing is double-counted and nothing moves.
 */

import React from 'react'
import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { prisma } from '@/lib/prisma'
import { nextInvoiceNumber } from '@/lib/orders'
import { InvoiceDocument, type InvoiceLineSnapshotEntry } from '@/lib/invoices/InvoiceDocument'

/** Statuses where taking a deposit makes sense. */
const DEPOSITABLE: ReadonlySet<string> = new Set([
  'DRAFT', 'QUOTE_SENT', 'APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB',
])

/** Printed on the deposit PDF. The client is being asked for money against
 *  a job that has not happened yet, so the document says what it is and what
 *  happens to it — otherwise it reads as a bill for a rental they have not
 *  had. */
const DEPOSIT_NOTE =
  'This is a deposit toward your rental, not the final invoice. ' +
  'It will be credited in full against your final invoice when the job wraps.'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export type DepositResult =
  | { ok: true; invoiceId: string; invoiceNumber: string; amount: number }
  | { ok: false; status: number; error: string }

/**
 * What this order has ALREADY collected in deposits.
 *
 * Counts CLEARED payments on non-void DEPOSIT invoices. Deliberately reads
 * the payments rather than `Invoice.amountPaid`: an ACH deposit sits
 * PENDING for days, and crediting money that has not cleared would hand a
 * client a reduced balance on the strength of a transfer that can still
 * bounce.
 */
export async function depositsCollected(orderId: string): Promise<number> {
  const rows = await prisma.payment.findMany({
    where: {
      voidedAt: null,
      status: 'CLEARED',
      invoice: { orderId, type: 'DEPOSIT', status: { not: 'VOID' } },
    },
    select: { amount: true },
  })
  return round2(rows.reduce((s, p) => s + Number(p.amount), 0))
}

/** The DEPOSIT_CREDIT line for a final invoice, or null when none applies. */
export function depositCreditLine(collected: number): InvoiceLineSnapshotEntry | null {
  if (collected < 0.01) return null
  return {
    description: 'Less deposit received',
    category: null,
    qty: 1,
    unitPrice: -collected,
    amount: -collected,
    kind: 'DEPOSIT_CREDIT' as const,
  }
}

/**
 * Raise a deposit invoice against an order.
 *
 * One line, by design (Wes, 2026-09-03): "Deposit — 50% of S260903-001".
 * Reprinting every rental line here would read as a bill for the whole job
 * and invite the client to treat those lines as final, which is exactly what
 * they are not — the order stays open and editable, which is the point.
 */
export async function createDepositInvoice(args: {
  orderId: string
  /** Dollars. Must be > 0. */
  amount: number
  /** Optional label, e.g. "50% deposit per Jose". */
  note?: string | null
  userId?: string | null
}): Promise<DepositResult> {
  const amount = round2(Number(args.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, error: 'Deposit amount must be greater than zero.' }
  }

  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true, orderNumber: true, status: true, total: true, bookedTotal: true,
      startDate: true, endDate: true,
      company: { select: { name: true, billingAddress: true, billingEmail: true } },
      job: { select: { jobCode: true, name: true } },
      agent: { select: { name: true, email: true, phone: true } },
    },
  })
  if (!order) return { ok: false, status: 404, error: 'order not found' }

  if (!DEPOSITABLE.has(order.status)) {
    return {
      ok: false,
      status: 409,
      error:
        `This order is ${order.status}. A deposit is money taken BEFORE the job wraps — ` +
        `at this point raise the final invoice instead.`,
    }
  }

  // Cap at what the job is currently expected to cost. Overshooting is not a
  // rounding slip, it is a typo (an extra zero), and the refund it creates is
  // real money out the door. The quote total moves, so this is a guard
  // against the obvious mistake, not a promise the figure is final.
  const expected = round2(Number(order.bookedTotal ?? order.total))
  const already = await depositsCollected(order.id)
  if (expected > 0 && round2(already + amount) > expected) {
    return {
      ok: false,
      status: 400,
      error:
        `That would collect ${fmt(already + amount)} against an order currently totalling ` +
        `${fmt(expected)}${already > 0 ? ` (${fmt(already)} already taken)` : ''}. ` +
        `Check the amount.`,
    }
  }

  const label = args.note?.trim()
    ? `Deposit — ${args.note.trim()}`
    : `Deposit toward ${order.orderNumber}`

  const snapshot: InvoiceLineSnapshotEntry[] = [{
    description: label,
    category: null,
    qty: 1,
    unitPrice: amount,
    amount,
    kind: 'DEPOSIT' as const,
  }]

  // Deposits draw from the RENTAL sequence on purpose: it is a real AR
  // document against the same order, and a separate series would put gaps
  // in the one Ana and QuickBooks reconcile against. `type` is what
  // distinguishes it, not the prefix.
  const invoiceNumber = await nextInvoiceNumber('RENTAL')
  const issuedAt = new Date()

  // ── Render the PDF ──────────────────────────────────────────────
  // Not optional: sendInvoice refuses any invoice with no pdfBlobKey
  // ("invoice has no PDF — regenerate first"), so a deposit without one
  // could be raised and then never actually sent to the client, which is
  // the only reason to raise it.
  //
  // No booking terms on this document. The four charge terms explain
  // refuelling, mileage and disposal — charges a deposit does not contain,
  // and this invoice is one line. They belong on the final invoice, which
  // is where those charges land.
  let pdfBytes: Buffer
  try {
    const element = React.createElement(InvoiceDocument, {
      invoiceNumber,
      invoiceType: 'DEPOSIT' as const,
      orderNumber: order.orderNumber,
      issuedAt,
      dueDate: issuedAt,
      servicePeriodStart: order.startDate,
      servicePeriodEnd: order.endDate,
      subtotal: amount,
      taxRate: 0,
      taxAmount: 0,
      total: amount,
      amountPaid: 0,
      balanceDue: amount,
      lines: snapshot,
      company: {
        name: order.company.name,
        billingAddress: order.company.billingAddress,
        billingEmail: order.company.billingEmail,
      },
      job: order.job ? { jobCode: order.job.jobCode, name: order.job.name } : null,
      agent: {
        name: order.agent.name,
        email: order.agent.email,
        phone: order.agent.phone ?? null,
      },
      notes: DEPOSIT_NOTE,
    }) as React.ReactElement<DocumentProps>
    pdfBytes = await renderToBuffer(element)
  } catch (err) {
    console.error('[createDepositInvoice] PDF render failed:', err)
    return { ok: false, status: 500, error: 'failed to render the deposit PDF' }
  }

  const yyyy = issuedAt.getUTCFullYear()
  const mm = String(issuedAt.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `invoices/${yyyy}/${mm}/${randomUUID()}-${invoiceNumber}.pdf`
  let blob
  try {
    blob = await put(blobKey, pdfBytes, {
      access: 'private' as 'public', // @vercel/blob types expose only 'public'; the private bucket takes the same call
      contentType: 'application/pdf',
    })
  } catch (err) {
    console.error('[createDepositInvoice] blob upload failed:', err)
    return { ok: false, status: 500, error: 'failed to upload the deposit PDF' }
  }

  const inv = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        orderId: order.id,
        invoiceNumber,
        type: 'DEPOSIT',
        status: 'DRAFT',
        subtotal: amount,
        taxAmount: 0,
        total: amount,
        amountPaid: 0,
        balanceDue: amount,
        // Due on receipt, matching every other SirReel invoice.
        dueDate: issuedAt,
        lineSnapshot: snapshot as unknown as object,
        notes: DEPOSIT_NOTE,
        pdfBlobKey: blobKey,
        pdfUrl: blob.url,
        pdfGeneratedAt: issuedAt,
      },
      select: { id: true, invoiceNumber: true },
    })
    await tx.auditLog.create({
      data: {
        action: 'invoice.deposit_created',
        entityType: 'Invoice',
        entityId: created.id,
        userId: args.userId ?? undefined,
        newValues: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderStatus: order.status,
          invoiceNumber: created.invoiceNumber,
          amount,
          // Recorded because the cap above is judged against it and the
          // order total moves afterwards.
          orderTotalAtIssue: expected,
          depositsAlreadyCollected: already,
        },
      },
    })
    return created
  })

  return { ok: true, invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, amount }
}

function fmt(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Did this order collect MORE than the job finally came to?
 *
 * Wes, 2026-09-03: flag it, do not move money. The final invoice can land
 * below the deposits taken — the shoot drops a day, a vehicle comes off —
 * and the difference is owed back. HQ says so and stops; issuing a refund
 * automatically would push real money out of the door on the strength of an
 * invoice nobody has looked at yet.
 *
 * Returns null when there is nothing to say, so callers can render the flag
 * only when it exists.
 */
export async function depositOverpayment(orderId: string): Promise<{
  collected: number
  finalTotal: number
  refundDue: number
} | null> {
  const collected = await depositsCollected(orderId)
  if (collected < 0.01) return null

  // The final RENTAL invoice is already NET of the deposit credit, so a
  // fully-settled job reads 0. Anything BELOW zero is the overshoot: the
  // credit exceeded what was left to bill.
  const final = await prisma.invoice.findFirst({
    where: { orderId, type: 'RENTAL', status: { not: 'VOID' } },
    orderBy: { createdAt: 'desc' },
    select: { total: true },
  })
  if (!final) return null

  const finalTotal = round2(Number(final.total))
  if (finalTotal >= -0.005) return null

  return { collected, finalTotal, refundDue: round2(Math.abs(finalTotal)) }
}
