/**
 * Render an invoice from its OWN stored snapshot — never from the live
 * order.
 *
 * This is the primitive behind two different needs that had each grown their
 * own copy of the same 80 lines:
 *
 *   · the PAID presentation (renderPaidInvoice) — the document with the
 *     verdict on it, rendered on demand and never stored
 *   · refreshing the stored PDF after a due-date or note edit
 *     (PATCH /api/invoices/[id]) — same figures, same lines, new header
 *
 * The distinction that matters: `generateRentalInvoice` re-derives
 * everything from the ORDER, which is the right thing when the order is
 * what changed and the wrong thing when it is not. Editing a due date must
 * not quietly pull in three days of unrelated line edits, so this renders
 * the invoice as issued and changes only what was asked for.
 *
 * Returns null when there is nothing to render from — an invoice cut before
 * `lineSnapshot` existed has only its blob, and the caller falls back to it
 * rather than 500ing.
 */

import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React from 'react'
import { prisma } from '@/lib/prisma'
import { InvoiceDocument, type InvoiceLineSnapshotEntry } from '@/lib/invoices/InvoiceDocument'
import { buildInvoiceBookingTerms, type BookingVehicleLine } from '@/lib/sales/bookingTerms'
import { paidViaLabel } from '@/lib/invoices/paymentMethods'

export async function renderStoredInvoice(invoiceId: string): Promise<Buffer | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      invoiceNumber: true,
      type: true,
      status: true,
      subtotal: true,
      taxAmount: true,
      total: true,
      amountPaid: true,
      balanceDue: true,
      paidAt: true,
      dueDate: true,
      notes: true,
      createdAt: true,
      lineSnapshot: true,
      discountSnapshot: true,
      // How it was paid, for the note under the title (Ana, 2026-09-11).
      payments: {
        where: { voidedAt: null, status: 'CLEARED' },
        orderBy: { receivedAt: 'asc' },
        select: { method: true },
      },
      order: {
        select: {
          orderNumber: true,
          startDate: true,
          endDate: true,
          taxRate: true,
          company: { select: { name: true, billingAddress: true, billingEmail: true } },
          job: { select: { jobCode: true, name: true } },
          agent: { select: { name: true, email: true, phone: true } },
          lineItems: {
            select: {
              type: true,
              department: true,
              description: true,
              inventoryItem: { select: { code: true } },
            },
          },
        },
      },
    },
  })
  if (!invoice) return null

  // Invoices issued before snapshots existed have nothing to print from.
  // The stored blob is still the truth for those.
  const lines = (invoice.lineSnapshot ?? null) as unknown as InvoiceLineSnapshotEntry[] | null
  if (!Array.isArray(lines) || lines.length === 0) return null
  const discountLines = (invoice.discountSnapshot ?? []) as unknown as {
    label: string
    amount: number
  }[]
  const o = invoice.order

  try {
    const bookingTerms = buildInvoiceBookingTerms({
      vehicles: o.lineItems
        .filter((li) => li.department === 'VEHICLES' && li.type !== 'DISCOUNT')
        .map<BookingVehicleLine>((li) => ({
          description: li.description,
          code: li.inventoryItem?.code ?? null,
        })),
    })

    const element = React.createElement(InvoiceDocument, {
      // The PAID mark is a property of the invoice's own status, not of who
      // asked for the render — a settled invoice looks settled everywhere.
      paid:
        invoice.status === 'PAID'
          ? { paidAt: invoice.paidAt, via: paidViaLabel(invoice.payments.map((p) => p.method)) }
          : undefined,
      invoiceNumber: invoice.invoiceNumber,
      invoiceType: invoice.type as 'RENTAL' | 'LD',
      orderNumber: o.orderNumber,
      issuedAt: invoice.createdAt,
      dueDate: invoice.dueDate,
      servicePeriodStart: o.startDate,
      servicePeriodEnd: o.endDate,
      subtotal: Number(invoice.subtotal),
      taxRate: Number(o.taxRate),
      taxAmount: Number(invoice.taxAmount),
      total: Number(invoice.total),
      amountPaid: Number(invoice.amountPaid),
      balanceDue: Number(invoice.balanceDue),
      lines,
      discountLines,
      company: {
        name: o.company.name,
        billingAddress: o.company.billingAddress,
        billingEmail: o.company.billingEmail,
      },
      job: o.job ? { jobCode: o.job.jobCode, name: o.job.name } : null,
      agent: { name: o.agent.name, email: o.agent.email, phone: o.agent.phone ?? null },
      notes: invoice.notes,
      bookingTerms,
    }) as React.ReactElement<DocumentProps>
    return await renderToBuffer(element)
  } catch (err) {
    console.error('[renderStoredInvoice] render error:', err)
    return null
  }
}
