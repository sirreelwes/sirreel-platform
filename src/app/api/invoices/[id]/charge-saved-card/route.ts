/**
 * GET  /api/invoices/[id]/charge-saved-card
 *   → probe: does a chargeable card-on-file exist for this invoice?
 *     Returns display fields ONLY (last4/type/cardholder). Never the token.
 *
 * POST /api/invoices/[id]/charge-saved-card  { amount?: number }
 *   → charge the card authorized on the invoice's booking against the
 *     invoice balance. Operator-attributed (staff-initiated).
 *
 * The saved token comes from the portal CC-authorization step (stored on
 * paperwork_requests via resolveSavedCardForInvoice). The client keeps the
 * card on file; this is how staff actually charge it later — deposits,
 * final balances — without the client re-entering the card.
 *
 * Auth: any authenticated staff session (mirrors the operator payments
 * route). Charge → recordPayment(CLEARED, method=CARDPOINTE, gatewayRefId).
 *
 * Money-safety guards:
 *   - invoice must be SENT/PARTIAL and amount ≤ balanceDue (server-clamped)
 *   - gateway decline → 402, gateway unreachable → 502, no Payment written
 *   - charged-but-DB-write-failed → 500 with retref for manual reconcile
 *   - recordPayment dedupes on (invoiceId, retref) as a backstop
 * Never logs raw card data. Token in, retref out, last4 stored as ref.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { PaymentMethod } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { chargeCard, isApproved } from '@/lib/cardpointe/client'
import { recordPayment } from '@/lib/invoices/recordPayment'
import { resolveSavedCardForInvoice } from '@/lib/invoices/savedCard'
import { surchargeBreakdown, CARD_SURCHARGE_LABEL } from '@/lib/payments/surcharge'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function requireUser(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true },
  })
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const card = await resolveSavedCardForInvoice(params.id)
  if (!card) return NextResponse.json({ hasCard: false })

  // Display fields only — the CardSecure token never leaves the server.
  return NextResponse.json({
    hasCard: true,
    last4: card.last4,
    cardType: card.cardType,
    cardholderName: card.cardholderName,
    authSignedAt: card.authSignedAt,
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: { id: true, invoiceNumber: true, status: true, balanceDue: true },
  })
  if (!invoice) return NextResponse.json({ error: 'invoice not found' }, { status: 404 })
  if (invoice.status !== 'SENT' && invoice.status !== 'PARTIAL') {
    return NextResponse.json(
      { error: `invoice is ${invoice.status.toLowerCase()} — not payable` },
      { status: 409 },
    )
  }

  const card = await resolveSavedCardForInvoice(params.id)
  if (!card) {
    return NextResponse.json(
      { error: 'no card on file for this invoice' },
      { status: 409 },
    )
  }

  const balanceDue = Number(invoice.balanceDue)
  if (!(balanceDue > 0)) {
    return NextResponse.json({ error: 'nothing due on this invoice' }, { status: 409 })
  }
  // Amount: explicit or full balance. Clamp to balance (server is truth).
  const body = (await req.json().catch(() => ({}))) as { amount?: unknown; waiveSurcharge?: unknown }
  const waiveSurcharge = body.waiveSurcharge === true
  const requested =
    body.amount === undefined || body.amount === null
      ? balanceDue
      : typeof body.amount === 'number'
        ? body.amount
        : Number(body.amount)
  if (!Number.isFinite(requested) || requested <= 0) {
    return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  }
  if (requested > balanceDue + 0.001) {
    return NextResponse.json(
      { error: `amount exceeds balance due ($${balanceDue.toFixed(2)})` },
      { status: 409 },
    )
  }
  // Base credits the invoice; the card is charged base + 3% surcharge,
  // UNLESS staff waived the fee for this charge (courtesy / negotiated).
  const breakdown = surchargeBreakdown(requested)
  const base = breakdown.base
  const surcharge = waiveSurcharge ? 0 : breakdown.surcharge
  const total = Math.round((base + surcharge) * 100) / 100

  // ── Charge the card on file through CardPointe ───────────────
  let charge
  try {
    charge = await chargeCard({
      cardToken: card.cardToken,
      amountDollars: total,
      invoiceNumber: invoice.invoiceNumber,
      cardholderName: card.cardholderName ?? undefined,
    })
  } catch (err) {
    console.error('[charge-saved-card] gateway error:', err)
    return NextResponse.json(
      { error: 'Payment gateway unreachable. Please try again.' },
      { status: 502 },
    )
  }

  if (!isApproved(charge) || !charge.retref) {
    return NextResponse.json(
      { error: charge.resptext || 'Card declined', respcode: charge.respcode },
      { status: 402 },
    )
  }

  // ── Record the payment (operator-attributed) ─────────────────
  // Credit the invoice the BASE; the surcharge is stored separately and
  // does not count toward the invoice balance.
  const cardRef = card.last4 ? `card ····${card.last4} (on file)` : 'card on file'
  const ref =
    surcharge > 0
      ? `${cardRef} +${CARD_SURCHARGE_LABEL}`
      : waiveSurcharge
        ? `${cardRef} (3% fee waived)`
        : cardRef
  const result = await recordPayment({
    invoiceId: invoice.id,
    amount: base,
    method: 'CARDPOINTE' satisfies PaymentMethod,
    receivedAt: new Date(),
    reference: ref,
    recordedById: user.id,
    gatewayRefId: charge.retref,
    surchargeAmount: surcharge,
  })
  if (!result.ok) {
    // Gateway charged but the DB write failed. Log loudly with the
    // retref so billing can reconcile manually — the money moved.
    console.error(
      '[charge-saved-card] CRITICAL: gateway charged retref=%s but record failed: %s',
      charge.retref,
      result.error,
    )
    return NextResponse.json(
      {
        error:
          'Card was charged but we could not record the payment. Reference: ' +
          charge.retref,
        retref: charge.retref,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    paymentId: result.paymentId,
    invoice: result.invoice,
    orderAdvancedToClosed: result.orderAdvancedToClosed,
    last4: card.last4,
    retref: charge.retref,
    base,
    surcharge,
    totalCharged: total,
  })
}
