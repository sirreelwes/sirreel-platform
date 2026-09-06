/**
 * GET /api/portal/company/[companyId]/rw-invoice/[rwInvoiceId]/pdf
 *
 * A RentalWorks invoice, for the account portal. RW is still the billing
 * source of truth for most shows, so an executive reading "what did we pay"
 * needs these alongside HQ-native invoices — 2026-09-05, every CMS job read
 * "Not yet invoiced" while RW held six invoices for them.
 *
 * Scope: the invoice must sit on an RW ORDER that a staff member linked to
 * a job of THIS company (JobRwOrder). That link is the human attribution
 * decision; nothing here re-derives it from customer names. An id from any
 * other account resolves to 404, same as every other read on this portal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'
import { RW_VOID } from '@/lib/rentalworks/arStatus'
import { loadRwInvoiceDetail, renderRwInvoicePdf, RW_INVOICE_ID_RE } from '@/lib/rentalworks/rwInvoicePdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(
  req: NextRequest,
  { params }: { params: { companyId: string; rwInvoiceId: string } },
) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
    where: { rwOrderNumber: mirror.orderNumber, job: { companyId: session.companyId } },
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
