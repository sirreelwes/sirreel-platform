/**
 * POST /api/payments/[id]/void
 *
 * Phase 5 commit 3 — symmetric undo for recordPayment. Stamps the
 * payment with voidedAt/voidedById/voidReason, recomputes invoice
 * totals, may regress invoice status and (if this kicked the order
 * from CLOSED) regresses Order CLOSED → INVOICED.
 *
 * Body: { reason: string }  — required, ≥4 chars.
 *
 * Honest about limits: voiding a payment doesn't unsend any
 * notification the client received; if PAID went out as a follow-up
 * email, it's already in the inbox. Operators should explain via a
 * direct touch when they reverse a payment.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { voidPayment } from '@/lib/invoices/recordPayment'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason : ''

  const result = await voidPayment({
    paymentId: params.id,
    voidedById: user.id,
    reason,
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
