/**
 * GET /api/portal/account/job/[jobId]/invoice/[invoiceId]/pdf
 *
 * The PERSON portal's copy of an invoice PDF — the third twin beside the
 * job-portal route (scoped to an order session) and the company route
 * (scoped to a company grant). This one requires the invoice's ORDER to sit
 * on a JOB the signed-in person is attached to. Deliberately its own
 * handler, for the same reason the other two are: the boundary is the
 * whole point, and a mode flag would put three boundaries in one place.
 *
 * Visibility matches the other two exactly: DRAFT only as the pre-invoice
 * once it has been sent for review, VOID never. 404, never 403.
 */

import { NextRequest, NextResponse } from 'next/server'
import { get as getBlob } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { getPersonJobAccessFromRequest } from '@/lib/portal/personJobAccess'
import { renderPreInvoice } from '@/lib/invoices/renderPreInvoice'
import { renderPaidInvoice, paidInvoiceResponse } from '@/lib/invoices/renderPaidInvoice'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string; invoiceId: string } },
) {
  const access = await getPersonJobAccessFromRequest(req, params.jobId)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const invoice = await prisma.invoice.findFirst({
    // Scoped to THIS job through the order — an invoice id from any other
    // show resolves to nothing.
    where: { id: params.invoiceId, order: { jobId: access.jobId } },
    select: { invoiceNumber: true, status: true, preSentAt: true, pdfBlobKey: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (invoice.status === 'DRAFT' && invoice.preSentAt) {
    return renderPreInvoice(params.invoiceId)
  }
  if (invoice.status === 'DRAFT' || invoice.status === 'VOID') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  // Settled invoices carry the PAID stamp, same as the staff copy — the
  // client's own view must not keep asking for money that arrived.
  if (invoice.status === 'PAID') {
    const stamped = await renderPaidInvoice(params.invoiceId)
    if (stamped) {
      return paidInvoiceResponse(
        stamped,
        invoice.invoiceNumber,
        req.nextUrl.searchParams.get('download') === '1',
      )
    }
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
    return new Response(blob.stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${wantDownload ? 'attachment' : 'inline'}; filename="Invoice-${invoice.invoiceNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[portal/account/job/invoice/pdf] blob fetch failed:', err)
    return NextResponse.json({ error: 'Failed to fetch PDF' }, { status: 500 })
  }
}
