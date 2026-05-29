/**
 * generateRentalInvoice — Phase 5 commit 1, the RW billing off-ramp.
 *
 * Generates a RENTAL Invoice row for an Order, renders the PDF,
 * uploads to private Vercel Blob, and stores the blob refs on the
 * Invoice. Mirrors the established contracts pattern
 * (renderToBuffer → put → store).
 *
 * The three money numbers doctrine, hard-coded into the math:
 *   - quote estimate  → Order.subtotal / total (the agent's working
 *                        copy; can change post-book — Phase 5 doesn't
 *                        prevent that)
 *   - booked value    → Order.bookedSubtotal / bookedTaxAmount /
 *                        bookedTotal / bookedAt (write-once at book
 *                        time; this generator NEVER writes these)
 *   - final invoice   → Invoice.total (the rental invoice anchored
 *                        to bookedTotal)
 *
 * Lifecycle constraints:
 *   - Order must have a booked snapshot (bookedTotal non-null) — i.e.
 *     it's been through bookOrder(). Reject otherwise.
 *   - At most ONE RENTAL invoice per Order at a time. If an existing
 *     non-VOID RENTAL exists, return 409 with the existing invoice id
 *     so the caller can surface it instead of minting a confusing
 *     second draft. (The schema allows many; the business rule is
 *     "void the existing one before generating a new one." Phase 5
 *     commit 1 doesn't ship the void affordance; operator can do it
 *     manually via Prisma if absolutely needed.)
 *
 * Adjustment math:
 *   - lineSnapshot is built from the LIVE order line items at issue
 *     time as RENTAL_LINE entries. Sum of those is each line's
 *     lineTotal (current order state).
 *   - Invoice.total is anchored to Order.bookedTotal — the canonical
 *     final number per the spec.
 *   - If sum(snapshot RENTAL_LINE amounts) != bookedSubtotal, an
 *     ADJUSTMENT line is appended with the delta so the snapshot
 *     sum + ADJUSTMENT equals bookedSubtotal. This keeps the
 *     three-numbers doctrine intact: post-book line edits are
 *     surfaced as explicit adjustments on the invoice, never as
 *     silent total drift.
 *
 * READ-ONLY against the booked snapshot. The bookOrder helper owns
 * those columns; this helper just reads.
 */

import React from 'react'
import { randomUUID } from 'crypto'
import { put, del } from '@vercel/blob'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { prisma } from '@/lib/prisma'
import { nextInvoiceNumber } from '@/lib/orders'
import {
  InvoiceDocument,
  type InvoiceLineSnapshotEntry,
} from './InvoiceDocument'

export type GenerateRentalInvoiceResult =
  | {
      ok: true
      invoiceId: string
      invoiceNumber: string
      pdfUrl: string
      pdfBlobKey: string
      total: string
    }
  | {
      ok: false
      status: number
      error: string
      existingInvoiceId?: string
    }

export async function generateRentalInvoice(args: {
  orderId: string
  /** Default due is issuedAt + 30 days unless caller provides one. */
  dueDate?: Date | null
  notes?: string | null
}): Promise<GenerateRentalInvoiceResult> {
  const { orderId, dueDate: dueDateOverride = null, notes = null } = args

  // ── Load order + line items + agent + company + job ─────────────
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      company: true,
      agent: true,
      job: true,
      lineItems: {
        include: { inventoryItem: { select: { code: true, description: true } }, assetCategory: { select: { name: true } } },
        orderBy: { sortOrder: 'asc' },
      },
      invoices: { select: { id: true, type: true, status: true } },
    },
  })
  if (!order) return { ok: false, status: 404, error: 'order not found' }

  // ── Guard: booked snapshot must exist ───────────────────────────
  if (order.bookedTotal == null) {
    return {
      ok: false,
      status: 409,
      error: 'order has no booked snapshot — book the order before invoicing',
    }
  }

  // ── Guard: one active RENTAL invoice at a time ──────────────────
  const existingActiveRental = order.invoices.find(
    (i) => i.type === 'RENTAL' && i.status !== 'VOID',
  )
  if (existingActiveRental) {
    return {
      ok: false,
      status: 409,
      error: 'order already has an active RENTAL invoice — void it before regenerating',
      existingInvoiceId: existingActiveRental.id,
    }
  }

  // ── Build line snapshot from the live order ─────────────────────
  // RENTAL_LINE entries mirror the order line items. The category
  // string is rebuilt from inventoryItem.description OR
  // assetCategory.name as fallback — same context the order detail
  // page shows.
  const rentalLines: InvoiceLineSnapshotEntry[] = order.lineItems.map((li) => ({
    description: li.description,
    category: li.inventoryItem?.code ?? li.assetCategory?.name ?? null,
    qty: li.quantity,
    unitPrice: Number(li.rate),
    amount: Number(li.lineTotal),
    kind: 'RENTAL_LINE' as const,
  }))

  const liveSubtotal = rentalLines.reduce((s, l) => s + l.amount, 0)
  const bookedSubtotal = Number(order.bookedSubtotal)
  const bookedTaxAmount = Number(order.bookedTaxAmount)
  const bookedTotal = Number(order.bookedTotal)

  // ── Adjustment line if post-book edits drifted the subtotal ────
  // Round to cents to avoid hairline FP noise creating bogus
  // adjustments. Anything within ±$0.01 is considered equal.
  const drift = Math.round((bookedSubtotal - liveSubtotal) * 100) / 100
  const snapshot: InvoiceLineSnapshotEntry[] = [...rentalLines]
  if (Math.abs(drift) >= 0.01) {
    snapshot.push({
      description:
        drift > 0
          ? 'Adjustment to match booked value (line edits since booking reduced subtotal)'
          : 'Adjustment to match booked value (line edits since booking increased subtotal)',
      category: null,
      qty: 1,
      unitPrice: drift,
      amount: drift,
      kind: 'ADJUSTMENT' as const,
    })
  }

  // ── Phase 5 commit 4: pull in BILL_NOW damage items ─────────────
  // Any DamageItem whose return Inspection belongs to one of this
  // order's BookingAssignments AND whose disposition is BILL_NOW AND
  // which hasn't already been billed elsewhere lands on this invoice
  // as a DAMAGE line. Pushes the invoice total above bookedTotal,
  // honoring the doctrine that minor/accepted damage rides the
  // rental invoice.
  const billNowDamages = order.bookedTotal == null
    ? []
    : await prisma.damageItem.findMany({
        where: {
          disposition: 'BILL_NOW',
          invoiceId: null,
          inspection: {
            bookingAssignment: {
              bookingItem: { bookingId: order.bookingId ?? '__none__' },
            },
          },
        },
        select: {
          id: true,
          locationOnVehicle: true,
          damageType: true,
          severity: true,
          estimatedRepairCost: true,
          inspection: {
            select: { asset: { select: { unitName: true } } },
          },
        },
      })
  const billNowTotal = billNowDamages.reduce(
    (s, d) => s + (d.estimatedRepairCost == null ? 0 : Number(d.estimatedRepairCost)),
    0,
  )
  for (const d of billNowDamages) {
    const amount = d.estimatedRepairCost == null ? 0 : Number(d.estimatedRepairCost)
    snapshot.push({
      description: `Damage — ${d.damageType.toLowerCase()} (${d.severity.toLowerCase()}) at ${d.locationOnVehicle}`,
      category: d.inspection.asset?.unitName ?? null,
      qty: 1,
      unitPrice: amount,
      amount,
      kind: 'DAMAGE' as const,
    })
  }
  const billNowDamageIds = billNowDamages.map((d) => d.id)

  const issuedAt = new Date()
  const dueDate =
    dueDateOverride ?? new Date(issuedAt.getTime() + 30 * 86_400_000)
  const invoiceNumber = await nextInvoiceNumber('RENTAL')
  // Invoice math: subtotal = booked + accepted damages. Tax still
  // anchored to the booked tax amount (damages are pass-through repair
  // costs; not a new tax computation here). Total = subtotal + tax.
  // Document the deviation from "Invoice.total == bookedTotal" when
  // damage was added so future readers see what changed.
  const invoiceSubtotal = bookedSubtotal + billNowTotal
  const invoiceTotal = bookedTotal + billNowTotal

  // ── Render PDF ──────────────────────────────────────────────────
  let pdfBytes: Buffer
  try {
    const element = React.createElement(InvoiceDocument, {
      invoiceNumber,
      invoiceType: 'RENTAL',
      orderNumber: order.orderNumber,
      issuedAt,
      dueDate,
      subtotal: invoiceSubtotal,
      taxAmount: bookedTaxAmount,
      total: invoiceTotal,
      amountPaid: 0,
      balanceDue: invoiceTotal,
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
      notes,
    }) as React.ReactElement<DocumentProps>
    pdfBytes = await renderToBuffer(element)
  } catch (err) {
    console.error('[generateRentalInvoice] PDF render failed:', err)
    return { ok: false, status: 500, error: 'failed to render invoice PDF' }
  }

  // ── Upload to private blob ──────────────────────────────────────
  const yyyy = issuedAt.getUTCFullYear()
  const mm = String(issuedAt.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `invoices/${yyyy}/${mm}/${randomUUID()}-${invoiceNumber}.pdf`
  let blob
  try {
    blob = await put(blobKey, pdfBytes, {
      access: 'private' as 'public', // @vercel/blob types only expose 'public' — private bucket accepts the same call
      contentType: 'application/pdf',
    })
  } catch (err) {
    console.error('[generateRentalInvoice] blob upload failed:', err)
    return { ok: false, status: 500, error: 'failed to upload invoice PDF' }
  }

  // ── Persist the Invoice row + tag billed damages ───────────────
  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        invoiceNumber,
        orderId,
        type: 'RENTAL',
        status: 'DRAFT',
        subtotal: invoiceSubtotal,
        taxAmount: bookedTaxAmount,
        total: invoiceTotal,
        amountPaid: 0,
        balanceDue: invoiceTotal,
        dueDate,
        notes,
        pdfBlobKey: blobKey,
        pdfUrl: blob.url,
        pdfGeneratedAt: issuedAt,
        // Cast for Prisma Json input — runtime is an array of
        // structured entries, but Prisma's JsonValue type is unioned
        // wide.
        lineSnapshot: snapshot as unknown as object,
      },
      select: { id: true },
    })
    if (billNowDamageIds.length > 0) {
      await tx.damageItem.updateMany({
        where: { id: { in: billNowDamageIds } },
        data: { invoiceId: inv.id },
      })
    }
    return inv
  })

  return {
    ok: true,
    invoiceId: invoice.id,
    invoiceNumber,
    pdfUrl: blob.url,
    pdfBlobKey: blobKey,
    total: invoiceTotal.toFixed(2),
  }
}

/**
 * Convenience: delete the prior PDF blob when an Invoice's PDF is
 * regenerated. Exported for symmetry with the SignedAgreement pattern;
 * Commit 1 doesn't expose a regenerate endpoint but commits 4+
 * may. Non-fatal failure.
 */
export async function deleteInvoiceBlob(blobKey: string): Promise<void> {
  try {
    await del(blobKey)
  } catch (err) {
    console.warn('[generateRentalInvoice] blob delete failed (non-fatal):', err)
  }
}
