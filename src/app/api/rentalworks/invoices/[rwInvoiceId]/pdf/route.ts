import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { createElement } from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { prisma } from '@/lib/prisma'
import { RwInvoiceDocument, type RwInvoiceDetail } from '@/lib/rentalworks/RwInvoiceDocument'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const RW_BASE = 'https://sirreel.rentalworks.cloud'

/**
 * GET /api/rentalworks/invoices/[rwInvoiceId]/pdf — HQ-rendered duplicate
 * of an RW invoice.
 *
 * RW can't export its own documents, so we fetch the live invoice record
 * and render a clean summary invoice (no line items exist to fetch — RW's
 * invoiceitem surface is empty tenant-wide). The PDF is labeled as
 * reproduced, with RW remaining the record. Rendered on the fly — always
 * current, nothing stored.
 */
export async function GET(_req: NextRequest, { params }: { params: { rwInvoiceId: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = params.rwInvoiceId
  if (!/^[A-Za-z0-9]{4,20}$/.test(id)) {
    return NextResponse.json({ error: 'bad invoice id' }, { status: 400 })
  }

  const token = process.env.RENTALWORKS_TOKEN
  if (!token) return NextResponse.json({ error: 'RentalWorks not configured' }, { status: 500 })

  let inv: RwInvoiceDetail | null = null
  try {
    const r = await fetch(`${RW_BASE}/api/v1/invoice/${id}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (r.ok) inv = (await r.json()) as RwInvoiceDetail
    else {
      // 2026-08-19: this used to short-circuit on 401/403 with "rotate the
      // token" — while the SAME token was returning 200 on the health probe
      // and the nightly browse minutes apart. RW rejects the per-record
      // invoice GET for a session bearer that list/browse endpoints accept;
      // the token is fine and rotating it fixes nothing. Whatever RW's
      // reason, the mirror row below has every field this PDF renders, so
      // any live-fetch failure degrades to the mirror instead of erroring.
      // Logged so the endpoint question stays visible in the function logs.
      console.error(`[rw-invoice-pdf] live fetch ${id} → HTTP ${r.status}; serving from mirror`)
    }
  } catch {
    /* fall through to mirror */
  }

  // RW unreachable → degrade to the mirror row (fewer fields, still a
  // usable summary; the footer timestamp reflects when it was rendered).
  if (!inv) {
    const m = await prisma.rwInvoice.findUnique({ where: { rwInvoiceId: id } })
    if (!m) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    inv = {
      InvoiceNumber: m.invoiceNumber ?? undefined,
      Status: m.status ?? undefined,
      InvoiceDate: m.invoiceDate?.toISOString(),
      InvoiceDueDate: m.dueDate?.toISOString(),
      Customer: m.customerName ?? undefined,
      PurchaseOrderNumber: m.poNumber ?? undefined,
      Deal: m.dealName ?? undefined,
      OrderNumber: m.orderNumber ?? undefined,
      OrderDescription: m.orderDescription ?? undefined,
      InvoiceDescription: m.invoiceDescription ?? undefined,
      BillingStartDate: m.billingStartDate?.toISOString(),
      BillingEndDate: m.billingEndDate?.toISOString(),
      Agent: m.agent ?? undefined,
      InvoiceSubTotal: Number(m.invoiceTotal),
      InvoiceTax: 0,
      InvoiceTotal: Number(m.invoiceTotal),
      ReceivedTotal: Number(m.receivedTotal),
      RemainingTotal: Number(m.remainingTotal),
    }
  }

  const renderedAt = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  const element = createElement(RwInvoiceDocument, { inv, renderedAt }) as unknown as React.ReactElement<DocumentProps>
  const pdf = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="RW-invoice-${inv.InvoiceNumber ?? id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
