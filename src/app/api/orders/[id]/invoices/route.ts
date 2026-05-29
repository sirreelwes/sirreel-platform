/**
 * POST /api/orders/[id]/invoices   — generates a RENTAL invoice.
 * GET  /api/orders/[id]/invoices   — lists invoices for an order (compact).
 *
 * Phase 5 commit 1 — the RW billing off-ramp.
 *
 * Auth: any authenticated session (matches /api/orders/[id]/book and
 * /fleet-ready). The order detail page only renders the Generate
 * button when `perms.billing` is true — server-side that check is
 * deferred to commits 2+ where the actions get tighter perms; for now
 * the goal is unblocking billing.
 *
 * For LD invoices: lands in Phase 5 commit 4 with its own POST body
 * shape (disposition + damage lines).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { generateRentalInvoice } from '@/lib/invoices/generateRentalInvoice'

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

  const result = await generateRentalInvoice({
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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const invoices = await prisma.invoice.findMany({
    where: { orderId: params.id },
    select: {
      id: true,
      invoiceNumber: true,
      type: true,
      status: true,
      subtotal: true,
      taxAmount: true,
      total: true,
      amountPaid: true,
      balanceDue: true,
      dueDate: true,
      sentAt: true,
      paidAt: true,
      pdfUrl: true,
      pdfGeneratedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ invoices })
}
