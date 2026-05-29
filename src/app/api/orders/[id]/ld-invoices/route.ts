/**
 * POST /api/orders/[id]/ld-invoices  — generate an LD invoice.
 *
 * Phase 5 commit 4. Picks up all SEND_TO_LD damage items on the
 * order that haven't already been billed and spins up a new LD
 * invoice (type=LD) carrying them as DAMAGE lines.
 *
 * Non-blocking on the rental arc per doctrine: LD invoices don't
 * gate Order.status — Order CLOSED is reachable with an open LD
 * invoice/claim.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { generateLdInvoice } from '@/lib/invoices/generateLdInvoice'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    dueDate?: unknown
    notes?: unknown
  }
  const dueDate =
    typeof body.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)
      ? new Date(`${body.dueDate}T00:00:00.000Z`)
      : null
  const notes =
    typeof body.notes === 'string' && body.notes.trim().length > 0
      ? body.notes.trim().slice(0, 5000)
      : null

  const result = await generateLdInvoice({
    orderId: params.id,
    dueDate,
    notes,
  })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, existingInvoiceId: result.existingInvoiceId },
      { status: result.status },
    )
  }

  return NextResponse.json(result, { status: 201 })
}
