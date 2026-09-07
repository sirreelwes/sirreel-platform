/**
 * GET /api/portal/account/job/[jobId]/rw-invoice/[rwInvoiceId]/pdf
 *
 * A RentalWorks invoice for the PERSON portal's show page. Scope: the
 * invoice's RW order must be one a staff member linked to THIS job
 * (JobRwOrder) — the same human attribution the company route trusts,
 * narrowed from the company to the one show the person is attached to.
 * 404, never 403.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getPersonJobAccessFromRequest } from '@/lib/portal/personJobAccess'
import { RW_VOID } from '@/lib/rentalworks/arStatus'
import { loadRwInvoiceDetail, renderRwInvoicePdf, RW_INVOICE_ID_RE } from '@/lib/rentalworks/rwInvoicePdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string; rwInvoiceId: string } },
) {
  const access = await getPersonJobAccessFromRequest(req, params.jobId)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!RW_INVOICE_ID_RE.test(params.rwInvoiceId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const mirror = await prisma.rwInvoice.findUnique({
    where: { rwInvoiceId: params.rwInvoiceId },
    select: { orderNumber: true, status: true, invoiceNumber: true },
  })
  if (!mirror?.orderNumber || mirror.status === RW_VOID) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const linked = await prisma.jobRwOrder.findFirst({
    where: { rwOrderNumber: mirror.orderNumber, jobId: access.jobId },
    select: { id: true },
  })
  if (!linked) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const inv = await loadRwInvoiceDetail(params.rwInvoiceId)
  if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const pdf = await renderRwInvoicePdf(inv)
  const wantDownload = req.nextUrl.searchParams.get('download') === '1'
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${wantDownload ? 'attachment' : 'inline'}; filename="Invoice-${inv.InvoiceNumber ?? mirror.invoiceNumber ?? params.rwInvoiceId}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
