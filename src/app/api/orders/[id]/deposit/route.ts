/**
 * POST /api/orders/[id]/deposit — raise a deposit invoice against an order.
 *
 * Money taken BEFORE the job wraps: a negotiated deposit, or the whole
 * rental paid upfront. Deliberately NOT the rental-invoice route with an
 * early date — see the header of src/lib/invoices/deposits.ts for why
 * invoicing early takes the order off Julian's dispatch board and locks the
 * rep out of editing lines.
 *
 * Creates the invoice in DRAFT. Sending it (and therefore asking the client
 * for the money) is the existing invoice send flow, unchanged — a DEPOSIT
 * passes straight through it because every lifecycle advance in
 * sendInvoice/recordPayment is already gated on `type === 'RENTAL'`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { createDepositInvoice } from '@/lib/invoices/deposits'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    amount?: unknown
    note?: unknown
  }

  const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount)
  if (!Number.isFinite(amount)) {
    return NextResponse.json({ error: 'amount is required' }, { status: 400 })
  }
  const note =
    typeof body.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : null

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

  const result = await createDepositInvoice({
    orderId: params.id,
    amount,
    note,
    userId: user?.id ?? null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result, { status: 201 })
}
