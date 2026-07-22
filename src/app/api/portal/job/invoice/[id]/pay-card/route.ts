/**
 * POST /api/portal/job/invoice/[id]/pay-card
 *
 * Phase 6 commit 2 — client-portal card payment. Cookie-authenticated
 * via the JOB_SESSION_COOKIE set by the magic-link entry. The
 * resolved session's order must own the invoice; 404 otherwise so
 * clients can't probe invoice ids outside their context.
 *
 * Flow:
 *   1. Validate body — cardToken, amount, cardholderName.
 *   2. Resolve session → invoice; guard SENT/PARTIAL + same order.
 *   3. Cap amount at invoice.balanceDue (defense in depth — UI also
 *      clamps, but server is source of truth).
 *   4. chargeCard() against CardPointe (UAT). Card auth+capture is
 *      instant.
 *   5. On approval: recordPortalPayment(status=CLEARED) — atomic
 *      Payment INSERT → reconcileInvoiceTotals → maybeAdvanceOrder
 *      ToClosed → AuditLog. CLEARED counts toward paid (LINCHPIN).
 *   6. On decline / gateway error: return 402 with the gateway's
 *      resptext. No Payment row written.
 *
 * Idempotency: recordPortalPayment dedupes on (invoiceId,
 * gatewayRefId). A retry that successfully charges the same retref
 * twice (shouldn't happen — gateway returns distinct retrefs) would
 * hit 409. A retry from the client BEFORE the first response landed
 * could double-charge — the UI disables submit on send to avoid this
 * common case.
 *
 * Never logs raw card data. Token in, retref out, last4 stored as
 * `reference` for human-readable trail.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { PaymentMethod, PaymentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { chargeCard, isApproved } from '@/lib/cardpointe/client'
import { recordPortalPayment } from '@/lib/invoices/recordPortalPayment'
import { surchargeBreakdown, CARD_SURCHARGE_LABEL } from '@/lib/payments/surcharge'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface PayCardBody {
  cardToken?: unknown
  cardholderName?: unknown
  amount?: unknown
  /** Last 4 of the card, captured from the tokenizer's UI for the
   *  audit trail. Optional; defaults to null. */
  last4?: unknown
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const body = (await req.json().catch(() => ({}))) as PayCardBody
  const cardToken =
    typeof body.cardToken === 'string' && body.cardToken.trim().length >= 10
      ? body.cardToken.trim()
      : null
  if (!cardToken) {
    return NextResponse.json({ error: 'cardToken required' }, { status: 400 })
  }
  const cardholderName =
    typeof body.cardholderName === 'string' && body.cardholderName.trim().length > 0
      ? body.cardholderName.trim().slice(0, 100)
      : null
  if (!cardholderName) {
    return NextResponse.json({ error: 'cardholderName required' }, { status: 400 })
  }
  const amount =
    typeof body.amount === 'number' && Number.isFinite(body.amount)
      ? body.amount
      : Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  }
  const last4 =
    typeof body.last4 === 'string' && /^\d{4}$/.test(body.last4) ? body.last4 : null

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      invoiceNumber: true,
      orderId: true,
      status: true,
      balanceDue: true,
    },
  })
  // 404 covers "doesn't exist" AND "belongs to a different order" so
  // the client never learns whether an id exists outside their
  // context.
  if (!invoice || invoice.orderId !== resolved.orderId) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }
  if (invoice.status !== 'SENT' && invoice.status !== 'PARTIAL') {
    return NextResponse.json(
      { error: `invoice is ${invoice.status.toLowerCase()} — not payable` },
      { status: 409 },
    )
  }
  const balanceDue = Number(invoice.balanceDue)
  if (amount > balanceDue + 0.001) {
    return NextResponse.json(
      { error: `amount exceeds balance due ($${balanceDue.toFixed(2)})` },
      { status: 409 },
    )
  }

  // Base credits the invoice; the card is charged base + 3% surcharge.
  const { base, surcharge, total } = surchargeBreakdown(amount)

  // ── Charge through CardPointe ────────────────────────────────
  let charge
  try {
    charge = await chargeCard({
      cardToken,
      amountDollars: total,
      invoiceNumber: invoice.invoiceNumber,
      cardholderName,
    })
  } catch (err) {
    console.error('[pay-card] gateway error:', err)
    return NextResponse.json(
      { error: 'Payment gateway unreachable. Please try again.' },
      { status: 502 },
    )
  }

  if (!isApproved(charge) || !charge.retref) {
    return NextResponse.json(
      {
        error: charge.resptext || 'Card declined',
        respcode: charge.respcode,
      },
      { status: 402 },
    )
  }

  // ── Persist Payment row ──────────────────────────────────────
  // Credit the invoice the BASE; the surcharge is stored separately and
  // does not count toward the invoice balance.
  const baseRef = last4 ? `card ····${last4}` : null
  const result = await recordPortalPayment({
    invoiceId: invoice.id,
    portalAccessId: resolved.portalAccessId,
    amount: base,
    method: 'CARDPOINTE' satisfies PaymentMethod,
    status: 'CLEARED' satisfies PaymentStatus,
    gatewayRefId: charge.retref,
    surchargeAmount: surcharge,
    receivedAt: new Date(),
    reference: surcharge > 0 && baseRef ? `${baseRef} +${CARD_SURCHARGE_LABEL}` : baseRef,
  })
  if (!result.ok) {
    // Edge case: gateway charged successfully but our DB write
    // failed. Log loudly and surface a generic message so the user
    // can call billing. Reconciliation is manual at that point —
    // we have the retref in the gateway, just no local Payment row.
    console.error(
      '[pay-card] CRITICAL: gateway charged retref=%s but DB write failed: %s',
      charge.retref,
      result.error,
    )
    return NextResponse.json(
      {
        error:
          'Card was charged but we could not record the payment. Please contact billing@sirreel.com with this reference: ' +
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
    last4,
    base,
    surcharge,
    totalCharged: total,
  })
}
