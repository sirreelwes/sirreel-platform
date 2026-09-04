/**
 * GET /api/portal/company/[companyId]/invoice/[invoiceId]/pdf
 *
 * The account portal's copy of an invoice PDF. A near-twin of
 * /api/portal/job/invoice/[id]/pdf, and deliberately NOT a shared handler:
 * the two differ in exactly the thing that matters — what the invoice must
 * belong to. The job-portal route requires the invoice's ORDER to match the
 * session; this one requires the invoice's COMPANY to. Folding them into
 * one function with a mode flag would put both boundaries in one place
 * where a wrong flag leaks an entire client's billing.
 *
 * Visibility matches the job portal exactly, so an executive can never see
 * an invoice the coordinator can't: DRAFT is invisible unless it has been
 * sent for review (then it renders as the pre-invoice), and VOID is never
 * served.
 *
 * 404, never 403 — see companyPortal.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { get as getBlob } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'
import { renderPreInvoice } from '@/lib/invoices/renderPreInvoice'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { companyId: string; invoiceId: string } },
) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const invoice = await prisma.invoice.findFirst({
    // Scoped by company through the order's job — an invoice id from
    // another account resolves to nothing.
    where: { id: params.invoiceId, order: { job: { companyId: session.companyId } } },
    select: {
      invoiceNumber: true,
      status: true,
      preSentAt: true,
      pdfBlobKey: true,
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (invoice.status === 'DRAFT' && invoice.preSentAt) {
    return renderPreInvoice(params.invoiceId)
  }
  if (invoice.status === 'DRAFT' || invoice.status === 'VOID') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!invoice.pdfBlobKey) {
    return NextResponse.json({ error: 'Invoice PDF not generated' }, { status: 404 })
  }

  try {
    const blob = await getBlob(invoice.pdfBlobKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: 'PDF not retrievable' }, { status: 500 })
    }
    const wantDownload = req.nextUrl.searchParams.get('download') === '1'
    const filename = `Invoice-${invoice.invoiceNumber}.pdf`
    return new Response(blob.stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${wantDownload ? 'attachment' : 'inline'}; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[portal/company/invoice/pdf] blob fetch failed:', err)
    return NextResponse.json({ error: 'Failed to fetch PDF' }, { status: 500 })
  }
}
