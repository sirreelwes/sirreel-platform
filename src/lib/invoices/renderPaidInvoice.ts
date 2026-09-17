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
 * The rendering itself is `renderStoredInvoice` (2026-09-17), which stamps
 * PAID off the invoice's own status — this function is the PAID-only GATE in
 * front of it, kept because its callers rely on a null for "not paid, serve
 * the blob" rather than on "could not render".
 *
 * Lives in lib for the same reason renderPreInvoice does — a non-handler
 * export from a route file passes tsc and fails `next build`.
 *
 * Returns null when the invoice cannot be re-rendered (not PAID, no line
 * snapshot), so callers can fall back to the stored blob rather than 500.
 */

import { prisma } from '@/lib/prisma'
import { renderStoredInvoice } from '@/lib/invoices/renderStoredInvoice'

export async function renderPaidInvoice(invoiceId: string): Promise<Buffer | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true },
  })
  if (!invoice || invoice.status !== 'PAID') return null
  return renderStoredInvoice(invoiceId)
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
