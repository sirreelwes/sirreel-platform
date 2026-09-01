import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React from 'react'
import { prisma } from '@/lib/prisma'
import { InvoiceDocument, type InvoiceLineSnapshotEntry } from '@/lib/invoices/InvoiceDocument'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

/**
 * GET /api/invoices/[id]/pre-invoice-pdf — the PRE-INVOICE rendering of
 * a DRAFT invoice (Wes 2026-09-01: the extra step before the final
 * invoice, where the client reviews and approves).
 *
 * Rendered ON DEMAND and never stored, the same reasoning as the
 * warehouse pick list: the stored blob is the FINAL invoice document,
 * and a second stored file titled "PRE-INVOICE" would be a second
 * artifact with the same invoice number — exactly the confusion this
 * round is meant to avoid. One invoice, one number, two presentations.
 *
 * Everything prints from the invoice's own stored snapshot (lines,
 * discounts, totals), so the figure the client approves is the figure
 * on the invoice — not a re-derivation off a live order that may have
 * moved since.
 *
 * Refuses once the invoice is actually issued: after that the real
 * document is the one to show, and a "not yet payable" banner over an
 * invoice the client owes money on would be a lie.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return renderPreInvoice(params.id)
}

/** Shared with the client-facing portal route, which authorises by token. */
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
