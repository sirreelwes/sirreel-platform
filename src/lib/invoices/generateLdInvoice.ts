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
 *   - At least one line, from either source (see below).
 *   - At most ONE active (non-VOID) LD invoice per order.
 *
 * ── Two sources of lines, since 2026-09-14 ────────────────────────────
 *
 * Ana: *"a way to bill L&D on a separate invoice. That would be a game
 * changer for me."* It already existed — for VEHICLE damage only, which is
 * the wrong half for the billing desk. Most L&D here is gear that came back
 * broken or did not come back at all, and that lives on the warehouse's
 * check-in sheet, not in a fleet inspection.
 *
 * So callers may now pass explicit `lines` (what Ana ticked and priced in
 * the composer — see ldCandidates.ts), and the SEND_TO_LD damage sweep is
 * SKIPPED when they do: the composer already listed those damages among its
 * candidates, so sweeping them in again would bill each one twice. Passing
 * `damageItemIds` stamps the invoice back onto those rows so they stop
 * appearing as unbilled.
 *
 * Calling it with no `lines` keeps the original behaviour exactly — the
 * order-page damage flow (LdDispositionPanel) is untouched, including its
 * requirement of a Booking, which only that path needs.
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

export interface LdInvoiceLineInput {
  description: string
  category?: string | null
  qty: number
  unitPrice: number
}

export async function generateLdInvoice(args: {
  orderId: string
  dueDate?: Date | null
  notes?: string | null
  /** Operator-composed lines. When present, the SEND_TO_LD sweep is skipped. */
  lines?: LdInvoiceLineInput[] | null
  /** DamageItems represented in `lines`, stamped with the new invoice id. */
  damageItemIds?: string[] | null
}): Promise<GenerateLdInvoiceResult> {
  const {
    orderId,
    dueDate: dueDateOverride = null,
    notes = null,
    lines: explicitLines = null,
    damageItemIds = null,
  } = args
  const composed = !!explicitLines && explicitLines.length > 0

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
  // Only the damage-sweep path needs a Booking: that is the chain to reach
  // DamageItems. Gear off a check-in sheet has no vehicle, and refusing it
  // here is what kept the desk from billing most of its L&D.
  if (!composed && !order.bookingId) {
    return {
      ok: false,
      status: 409,
      error: 'order has no linked Booking — LD damage capture requires an assigned vehicle',
    }
  }

  // Pull SEND_TO_LD damages not already on an invoice. Hoisted into its own
  // helper so the composed path can skip it without the empty branch
  // collapsing the row type.
  const sweepDamages = (bookingId: string) =>
    prisma.damageItem.findMany({
      where: {
        disposition: 'SEND_TO_LD',
        invoiceId: null,
        inspection: { bookingAssignment: { bookingItem: { bookingId } } },
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

  const ldDamages =
    !composed && order.bookingId ? await sweepDamages(order.bookingId) : []
  if (!composed && ldDamages.length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'no SEND_TO_LD damage items pending billing on this order',
    }
  }

  const snapshot: InvoiceLineSnapshotEntry[] = composed
    ? explicitLines!.map((l) => ({
        description: l.description,
        category: l.category ?? null,
        qty: l.qty,
        unitPrice: l.unitPrice,
        amount: Math.round(l.qty * l.unitPrice * 100) / 100,
        kind: 'DAMAGE' as const,
      }))
    : ldDamages.map((d) => ({
        description: `Damage — ${d.damageType.toLowerCase()} (${d.severity.toLowerCase()}) at ${d.locationOnVehicle}`,
        category: d.inspection.asset?.unitName ?? null,
        qty: 1,
        unitPrice: d.estimatedRepairCost == null ? 0 : Number(d.estimatedRepairCost),
        amount: d.estimatedRepairCost == null ? 0 : Number(d.estimatedRepairCost),
        kind: 'DAMAGE' as const,
      }))
  if (snapshot.length === 0) {
    return { ok: false, status: 400, error: 'an L&D invoice needs at least one line' }
  }
  const subtotal = snapshot.reduce((s, l) => s + l.amount, 0)
  const total = subtotal // no tax on LD invoices — repair pass-through

  const issuedAt = new Date()
  // SirReel does not use Net terms — all invoices are due on receipt.
  // dueDate = issuedAt so downstream aging math still works.
  const dueDate = dueDateOverride ?? issuedAt
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
      servicePeriodStart: order.startDate,
      servicePeriodEnd: order.endDate,
      subtotal,
      taxRate: 0,
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
    // Stamp the damages this invoice carries so they stop reading as
    // unbilled — the swept ones on the original path, the ticked ones on
    // the composed path.
    const stampIds = composed ? (damageItemIds ?? []) : ldDamages.map((d) => d.id)
    if (stampIds.length) {
      await tx.damageItem.updateMany({
        where: { id: { in: stampIds } },
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
    total: total.toFixed(2),
  }
}
