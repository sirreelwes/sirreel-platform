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
import { reverseCardCharge } from '@/lib/cardpointe/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  // Look at the payment: a CardPointe charge with a gateway retref must be
  // reversed at the processor (void pre-settlement, refund after) BEFORE
  // we mark it voided locally — otherwise the invoice shows unpaid while
  // the client's money is still captured. Already-voided rows skip the
  // gateway (voidPayment returns 409) so a retry can't double-refund.
  const payment = await prisma.payment.findUnique({
    where: { id: params.id },
    select: { id: true, method: true, gatewayRefId: true, amount: true, voidedAt: true },
  })
  if (!payment) return NextResponse.json({ ok: false, error: 'payment not found' }, { status: 404 })

  let reversalNote = ''
  if (payment.method === 'CARDPOINTE' && payment.gatewayRefId && !payment.voidedAt) {
    let reversal
    try {
      reversal = await reverseCardCharge({
        retref: payment.gatewayRefId,
        amountDollars: Number(payment.amount),
      })
    } catch (err) {
      console.error('[payment.void] gateway error:', err)
      return NextResponse.json(
        { ok: false, error: 'Payment gateway unreachable — payment left as-is. Try again.' },
        { status: 502 },
      )
    }
    if (!reversal.ok) {
      // Money NOT returned — do not void locally, keep the record honest.
      return NextResponse.json(
        { ok: false, error: `Could not reverse the card charge: ${reversal.message}` },
        { status: 502 },
      )
    }
    reversalNote = ` [CardPointe ${reversal.kind} ${reversal.retref ?? ''}]`.trimEnd()
  }

  const result = await voidPayment({
    paymentId: params.id,
    voidedById: user.id,
    // Append the reversal kind + retref to the audit reason so the trail
    // shows how the money came back. Empty for non-card voids.
    reason: reversalNote ? `${reason}${reversalNote}` : reason,
  })
  if (!result.ok) {
    if (reversalNote) {
      // Critical split: the gateway reversed the money but the local void
      // write failed. The invoice still shows paid. Log loudly with the
      // retref for manual reconciliation.
      console.error(
        '[payment.void] CRITICAL: gateway reversed%s but local void failed: %s',
        reversalNote,
        result.error,
      )
    }
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
