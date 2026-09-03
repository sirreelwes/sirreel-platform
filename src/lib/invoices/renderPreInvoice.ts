/**
 * Render the PRE-INVOICE presentation of a DRAFT invoice.
 *
 * Lives here rather than in the route that first needed it because a
 * Next.js route file may only export the handler names plus the known
 * config fields — `export async function renderPreInvoice` from
 * `api/invoices/[id]/pre-invoice-pdf/route.ts` passed `tsc --noEmit` and
 * then failed `next build` with "not a valid Route export field", taking
 * three production deploys down with it on 2026-09-01. Two routes import
 * this (the staff one, session-gated; the portal one, token-gated), so it
 * belongs in lib.
 *
 * Rendered ON DEMAND and never stored, the same reasoning as the warehouse
 * pick list: the stored blob is the FINAL invoice document, and a second
 * stored file titled "PRE-INVOICE" would be a second artifact carrying the
 * same invoice number.
 *
 * Everything prints from the invoice's own stored snapshot (lines,
 * discounts, totals), so the figure the client approves is the figure on
 * the invoice — not a re-derivation off a live order that may have moved.
 *
 * Refuses once the invoice is actually issued: after that the real document
 * is the one to show, and a "not yet payable" banner over an invoice the
 * client owes money on would be a lie.
 */

import { NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React from 'react'
import { prisma } from '@/lib/prisma'
import { InvoiceDocument, type InvoiceLineSnapshotEntry } from '@/lib/invoices/InvoiceDocument'
import { buildInvoiceBookingTerms, type BookingVehicleLine } from '@/lib/sales/bookingTerms'

export async function renderPreInvoice(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      invoiceNumber: true,
      type: true,
      status: true,
      subtotal: true,
      taxAmount: true,
      total: true,
      dueDate: true,
      notes: true,
      createdAt: true,
      lineSnapshot: true,
      discountSnapshot: true,
      order: {
        select: {
          orderNumber: true,
          startDate: true,
          endDate: true,
          taxRate: true,
          company: { select: { name: true, billingAddress: true, billingEmail: true } },
          job: { select: { jobCode: true, name: true } },
          agent: { select: { name: true, email: true, phone: true } },
          // Charge-terms input. The pre-invoice prices off lineSnapshot, but
          // the terms are gated on whether the order has VEHICLES at all,
          // which the snapshot does not record.
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
  if (!invoice) return NextResponse.json({ error: 'invoice not found' }, { status: 404 })
  if (invoice.status !== 'DRAFT') {
    return NextResponse.json(
      {
        error: 'not a pre-invoice',
        reason: `This invoice is ${invoice.status.toLowerCase()} — the issued invoice is the document to show.`,
      },
      { status: 409 },
    )
  }

  const lines = (invoice.lineSnapshot ?? []) as unknown as InvoiceLineSnapshotEntry[]
  const discountLines = (invoice.discountSnapshot ?? []) as unknown as {
    label: string
    amount: number
  }[]
  const o = invoice.order

  let pdfBytes: Buffer
  try {
    // Same charge terms the issued invoice will carry — the pre-invoice is
    // what a client is shown BEFORE it is issued, so it must not preview a
    // document missing a block the real one has.
    const bookingTerms = buildInvoiceBookingTerms({
      vehicles: o.lineItems
        .filter((li) => li.department === 'VEHICLES' && li.type !== 'DISCOUNT')
        .map<BookingVehicleLine>((li) => ({
          description: li.description,
          code: li.inventoryItem?.code ?? null,
        })),
    })

    const element = React.createElement(InvoiceDocument, {
      isPreInvoice: true,
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
      amountPaid: 0,
      balanceDue: Number(invoice.total),
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
    pdfBytes = await renderToBuffer(element)
  } catch (err) {
    console.error('[pre-invoice-pdf] render error:', err)
    return NextResponse.json({ error: 'Failed to render the pre-invoice.' }, { status: 500 })
  }

  return new NextResponse(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="PreInvoice-${invoice.invoiceNumber}.pdf"`,
      'Content-Length': String(pdfBytes.length),
      'Cache-Control': 'private, no-store',
    },
  })
}
