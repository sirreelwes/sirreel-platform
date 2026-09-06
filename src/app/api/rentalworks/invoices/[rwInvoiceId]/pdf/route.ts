import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { loadRwInvoiceDetail, renderRwInvoicePdf, RW_INVOICE_ID_RE } from '@/lib/rentalworks/rwInvoicePdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 30


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
  if (!RW_INVOICE_ID_RE.test(id)) {
    return NextResponse.json({ error: 'bad invoice id' }, { status: 400 })
  }

  // Live-then-mirror + the document itself live in rwInvoicePdf.ts, shared
  // with the account portal's copy so the two can never drift.
  const inv = await loadRwInvoiceDetail(id)
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const pdf = await renderRwInvoicePdf(inv)
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="RW-invoice-${inv.InvoiceNumber ?? id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
