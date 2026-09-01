import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { renderPreInvoice } from '@/lib/invoices/renderPreInvoice'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

/**
 * GET /api/invoices/[id]/pre-invoice-pdf — the PRE-INVOICE rendering of
 * a DRAFT invoice (Wes 2026-09-01: the extra step before the final
 * invoice, where the client reviews and approves).
 *
 * The renderer itself lives in lib/invoices/renderPreInvoice — a route
 * file may not export anything but its handlers and the known config
 * fields, and exporting it from here failed the production build.
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
