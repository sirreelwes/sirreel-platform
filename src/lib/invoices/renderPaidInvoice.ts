/**
 * Render the PAID presentation of a settled invoice.
 *
 * Ana, 2026-09-10: "Is there a PAID stamp for paid invoices? Like the ones
 * we have in RentalWorks." There was not. The stored blob is rendered once,
 * at issue, with amountPaid 0 and the full balance due — and regenerate
 * refuses once money has been applied, correctly, because a payment was
 * taken against a stated figure. So a paid invoice opened from anywhere in
 * HQ or the portal still read "Balance Due $4,200.00" with a Zelle QR under
 * it, which is a document that gets paid twice.
 *
 * Same pattern as the pre-invoice: rendered ON DEMAND from the invoice's own
 * stored snapshot, never stored. The blob stays the document the client was
 * billed on; this is that document with the verdict on it. One invoice, one
 * number, one more presentation.
 *
 * Lives in lib for the same reason renderPreInvoice does — a non-handler
 * export from a route file passes tsc and fails `next build`.
 *
 * Returns null when the invoice cannot be re-rendered (not PAID, no line
 * snapshot), so callers can fall back to the stored blob rather than 500.
 */

import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React from 'react'
import { prisma } from '@/lib/prisma'
import { InvoiceDocument, type InvoiceLineSnapshotEntry } from '@/lib/invoices/InvoiceDocument'
import { buildInvoiceBookingTerms, type BookingVehicleLine } from '@/lib/sales/bookingTerms'
import { paidViaLabel } from '@/lib/invoices/paymentMethods'

export async function renderPaidInvoice(invoiceId: string): Promise<Buffer | null> {
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
  if (!invoice || invoice.status !== 'PAID') return null

  // Invoices issued before snapshots existed have nothing to print from.
  // The stored blob is still the truth for those — just unstamped.
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
      paid: { paidAt: invoice.paidAt, via: paidViaLabel(invoice.payments.map((p) => p.method)) },
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
    console.error('[paid-invoice-pdf] render error:', err)
    return null
  }
}

/** The response for a stamped render — shared by the staff and portal
 *  proxies so the filename and headers agree. */
export function paidInvoiceResponse(
  pdfBytes: Buffer,
  invoiceNumber: string,
  wantDownload: boolean,
): Response {
  const filename = `Invoice-${invoiceNumber}-PAID.pdf`
  return new Response(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': wantDownload
        ? `attachment; filename="${filename}"`
        : `inline; filename="${filename}"`,
      'Content-Length': String(pdfBytes.length),
      'Cache-Control': 'private, no-store',
    },
  })
}
