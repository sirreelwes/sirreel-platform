/**
 * GET /api/invoices/[id]/pdf
 *
 * Auth-gated proxy for the private Invoice PDF blob. Mirrors the
 * quote-pdf GET route. Modes:
 *   default       → Content-Disposition: inline   (browser preview)
 *   ?download=1   → Content-Disposition: attachment (file download)
 *   ?meta=1       → JSON metadata only (no proxy)
 *   ?original=1   → the stored blob even when the invoice is PAID
 *
 * A PAID invoice is served STAMPED — re-rendered on demand from its stored
 * snapshot with the PAID mark, the settlement date, the real amount-paid /
 * balance figures and no pay-by blocks (Ana, 2026-09-10). The blob is never
 * rewritten: it is the document the client was billed on. Falls back to the
 * blob when the stamped render is not possible (pre-snapshot invoice).
 *
 * Phase 5 commit 1. Future client-portal route (commit 2) lives at a
 * separate path with magic-link auth instead of session auth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { get as getBlob } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { renderPaidInvoice, paidInvoiceResponse } from '@/lib/invoices/renderPaidInvoice'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: {
      invoiceNumber: true,
      status: true,
      pdfBlobKey: true,
      pdfUrl: true,
      pdfGeneratedAt: true,
    },
  })
  if (!invoice) {
    return NextResponse.json({ error: 'invoice not found' }, { status: 404 })
  }

  const wantMeta = req.nextUrl.searchParams.get('meta') === '1'
  if (wantMeta) {
    return NextResponse.json({
      url: invoice.pdfUrl,
      key: invoice.pdfBlobKey,
      generatedAt: invoice.pdfGeneratedAt,
    })
  }

  const wantDownload = req.nextUrl.searchParams.get('download') === '1'
  if (invoice.status === 'PAID' && req.nextUrl.searchParams.get('original') !== '1') {
    const stamped = await renderPaidInvoice(params.id)
    if (stamped) return paidInvoiceResponse(stamped, invoice.invoiceNumber, wantDownload)
  }

  if (!invoice.pdfBlobKey) {
    return NextResponse.json(
      { error: 'invoice has no PDF — regenerate first' },
      { status: 404 },
    )
  }

  try {
    const blob = await getBlob(invoice.pdfBlobKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json(
        { error: 'PDF blob not retrievable' },
        { status: 500 },
      )
    }
    const filename = `Invoice-${invoice.invoiceNumber}.pdf`
    return new Response(blob.stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': wantDownload
          ? `attachment; filename="${filename}"`
          : `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[invoices/pdf] blob fetch failed:', err)
    return NextResponse.json(
      { error: 'failed to fetch invoice PDF' },
      { status: 500 },
    )
  }
}
