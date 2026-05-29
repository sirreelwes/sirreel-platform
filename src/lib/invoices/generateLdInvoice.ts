/**
 * generateLdInvoice — Phase 5 commit 4. Spins up a satellite LD
 * invoice (type=LD) carrying SEND_TO_LD damage items as DAMAGE lines.
 *
 * Doctrine — NON-BLOCKING. The LD invoice is its own object:
 *   - It never gates Order.status. The rental arc reaches CLOSED on
 *     payment of the RENTAL invoice; an open LD invoice stays open.
 *   - It carries its own InsuranceClaim satellite (Phase 5 commit 4
 *     also adds the claim-link FK; opening the claim is a separate
 *     action on top of this invoice).
 *
 * Math:
 *   - Subtotal = sum(SEND_TO_LD damage estimatedRepairCost).
 *   - No tax (repair pass-throughs aren't a SirReel taxable service).
 *   - Total = subtotal.
 *
 * Guards:
 *   - Order must have a Booking with at least one BookingAssignment —
 *     LD damage hangs off Inspection.bookingAssignment, no chain to
 *     reach DamageItems without that.
 *   - At least one SEND_TO_LD damage item must exist for the order
 *     with invoiceId IS NULL.
 *   - At most ONE active (non-VOID) LD invoice per order — like the
 *     RENTAL guard. Operators void before regenerating.
 *
 * READ-ONLY against Order.booked* — the booked snapshot stays
 * untouched. LD invoice math doesn't reference it.
 */

import React from 'react'
import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { prisma } from '@/lib/prisma'
import { nextInvoiceNumber } from '@/lib/orders'
import {
  InvoiceDocument,
  type InvoiceLineSnapshotEntry,
} from './InvoiceDocument'

export type GenerateLdInvoiceResult =
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

export async function generateLdInvoice(args: {
  orderId: string
  dueDate?: Date | null
  notes?: string | null
}): Promise<GenerateLdInvoiceResult> {
  const { orderId, dueDate: dueDateOverride = null, notes = null } = args

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      company: true,
      agent: true,
      job: true,
      invoices: { select: { id: true, type: true, status: true } },
    },
  })
  if (!order) return { ok: false, status: 404, error: 'order not found' }

  // Reject existing active LD invoice.
  const existingActiveLd = order.invoices.find(
    (i) => i.type === 'LD' && i.status !== 'VOID',
  )
  if (existingActiveLd) {
    return {
      ok: false,
      status: 409,
      error: 'order already has an active LD invoice — void it before regenerating',
      existingInvoiceId: existingActiveLd.id,
    }
  }
  if (!order.bookingId) {
    return {
      ok: false,
      status: 409,
      error: 'order has no linked Booking — LD damage capture requires an assigned vehicle',
    }
  }

  // Pull SEND_TO_LD damages not already on an invoice.
  const ldDamages = await prisma.damageItem.findMany({
    where: {
      disposition: 'SEND_TO_LD',
      invoiceId: null,
      inspection: {
        bookingAssignment: {
          bookingItem: { bookingId: order.bookingId },
        },
      },
    },
    select: {
      id: true,
      locationOnVehicle: true,
      damageType: true,
      severity: true,
      estimatedRepairCost: true,
      inspection: { select: { asset: { select: { unitName: true } } } },
    },
  })
  if (ldDamages.length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'no SEND_TO_LD damage items pending billing on this order',
    }
  }

  const snapshot: InvoiceLineSnapshotEntry[] = ldDamages.map((d) => ({
    description: `Damage — ${d.damageType.toLowerCase()} (${d.severity.toLowerCase()}) at ${d.locationOnVehicle}`,
    category: d.inspection.asset?.unitName ?? null,
    qty: 1,
    unitPrice: d.estimatedRepairCost == null ? 0 : Number(d.estimatedRepairCost),
    amount: d.estimatedRepairCost == null ? 0 : Number(d.estimatedRepairCost),
    kind: 'DAMAGE' as const,
  }))
  const subtotal = snapshot.reduce((s, l) => s + l.amount, 0)
  const total = subtotal // no tax on LD invoices — repair pass-through

  const issuedAt = new Date()
  const dueDate =
    dueDateOverride ?? new Date(issuedAt.getTime() + 30 * 86_400_000)
  const invoiceNumber = await nextInvoiceNumber('LD')

  // Render PDF — same InvoiceDocument, type-discriminated header.
  let pdfBytes: Buffer
  try {
    const element = React.createElement(InvoiceDocument, {
      invoiceNumber,
      invoiceType: 'LD',
      orderNumber: order.orderNumber,
      issuedAt,
      dueDate,
      subtotal,
      taxAmount: 0,
      total,
      amountPaid: 0,
      balanceDue: total,
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
    console.error('[generateLdInvoice] PDF render failed:', err)
    return { ok: false, status: 500, error: 'failed to render LD invoice PDF' }
  }

  const yyyy = issuedAt.getUTCFullYear()
  const mm = String(issuedAt.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `invoices/${yyyy}/${mm}/${randomUUID()}-${invoiceNumber}.pdf`
  let blob
  try {
    blob = await put(blobKey, pdfBytes, {
      access: 'private' as 'public',
      contentType: 'application/pdf',
    })
  } catch (err) {
    console.error('[generateLdInvoice] blob upload failed:', err)
    return { ok: false, status: 500, error: 'failed to upload LD invoice PDF' }
  }

  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        invoiceNumber,
        orderId,
        type: 'LD',
        status: 'DRAFT',
        subtotal,
        taxAmount: 0,
        total,
        amountPaid: 0,
        balanceDue: total,
        dueDate,
        notes,
        pdfBlobKey: blobKey,
        pdfUrl: blob.url,
        pdfGeneratedAt: issuedAt,
        lineSnapshot: snapshot as unknown as object,
      },
      select: { id: true },
    })
    await tx.damageItem.updateMany({
      where: { id: { in: ldDamages.map((d) => d.id) } },
      data: { invoiceId: inv.id },
    })
    return inv
  })

  return {
    ok: true,
    invoiceId: invoice.id,
    invoiceNumber,
    pdfUrl: blob.url,
    pdfBlobKey: blobKey,
    total: total.toFixed(2),
  }
}
