/**
 * POST /api/portal/job/invoice/[id]/pay-ach
 *
 * Phase 6 commit 3 — client-portal ACH (eCheck) origination. Cookie-
 * authenticated via JOB_SESSION_COOKIE.
 *
 * Behind the ACH feature flag (ACH_ENABLED env). When the flag is
 * off this endpoint returns 503 — protects against accidental ACH
 * submissions before CardPointe underwriting completes. The portal
 * UI also hides the ACH method when the public flag is off, but the
 * server flag is the authoritative gate.
 *
 * Flow:
 *   1. Validate feature flag, body, session → invoice ownership.
 *   2. Cap amount at invoice.balanceDue (server is source of truth).
 *   3. originateAch() against CardPointe. ACH origination is async
 *      from the bank's POV — the gateway returns immediately with
 *      a retref, but funds don't actually settle for 1–2 business
 *      days.
 *   4. On approval: recordPortalPayment(status=PENDING) — LINCHPIN
 *      means PENDING does NOT count toward invoice paid, does NOT
 *      advance the order. The polling job (Commit 4) walks the
 *      retref forward to SETTLED → CLEARED via gateway inquire.
 *   5. NACHA authorization artifact captured on the row: signature
 *      data URL + consent text + signed-at timestamp.
 *
 * Idempotency same as card: dedupe on (invoiceId, gatewayRefId).
 *
 * Never logs raw bank account numbers — token in, retref out, last4
 * stored in `reference` for the audit trail.
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
import { originateAch, isApproved } from '@/lib/cardpointe/client'
import { recordPortalPayment } from '@/lib/invoices/recordPortalPayment'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Server-side ACH gate. Distinct from NEXT_PUBLIC_ACH_ENABLED — the
// public flag controls UI visibility; this controls origination.
const ACH_ENABLED = process.env.ACH_ENABLED === 'true'

interface PayAchBody {
  bankAccountToken?: unknown
  routingNumber?: unknown
  accountType?: unknown // 'C' (checking) | 'S' (savings)
  accountHolderName?: unknown
  amount?: unknown
  last4?: unknown
  /** NACHA authorization artifacts — captured in the UI alongside the
   *  signature pad. */
  nachaSignatureData?: unknown
  nachaText?: unknown
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!ACH_ENABLED) {
    return NextResponse.json(
      { error: 'ACH payments are not currently available. Please use card or contact billing@sirreel.com.' },
      { status: 503 },
    )
  }

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

  const body = (await req.json().catch(() => ({}))) as PayAchBody

  const bankAccountToken =
    typeof body.bankAccountToken === 'string' && body.bankAccountToken.trim().length >= 10
      ? body.bankAccountToken.trim()
      : null
  if (!bankAccountToken) {
    return NextResponse.json({ error: 'bankAccountToken required' }, { status: 400 })
  }
  const routingNumber =
    typeof body.routingNumber === 'string' && /^\d{9}$/.test(body.routingNumber.trim())
      ? body.routingNumber.trim()
      : null
  if (!routingNumber) {
    return NextResponse.json({ error: 'routingNumber must be 9 digits' }, { status: 400 })
  }
  const accountType =
    body.accountType === 'C' || body.accountType === 'S' ? body.accountType : null
  if (!accountType) {
    return NextResponse.json({ error: "accountType must be 'C' or 'S'" }, { status: 400 })
  }
  const accountHolderName =
    typeof body.accountHolderName === 'string' && body.accountHolderName.trim().length > 0
      ? body.accountHolderName.trim().slice(0, 100)
      : null
  if (!accountHolderName) {
    return NextResponse.json({ error: 'accountHolderName required' }, { status: 400 })
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

  // NACHA artifacts — required for ACH. Without an explicit
  // authorization the bank can claw the funds back as unauthorized.
  const nachaSignatureData =
    typeof body.nachaSignatureData === 'string' && body.nachaSignatureData.startsWith('data:image/')
      ? body.nachaSignatureData
      : null
  if (!nachaSignatureData) {
    return NextResponse.json(
      { error: 'NACHA signature required to authorize bank debit' },
      { status: 400 },
    )
  }
  const nachaText =
    typeof body.nachaText === 'string' && body.nachaText.trim().length >= 20
      ? body.nachaText.trim().slice(0, 5000)
      : null
  if (!nachaText) {
    return NextResponse.json(
      { error: 'NACHA consent text required (≥20 chars)' },
      { status: 400 },
    )
  }

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

  // ── Originate through CardPointe ──────────────────────────────
  let result
  try {
    result = await originateAch({
      bankAccountToken,
      routingNumber,
      accountType,
      amountDollars: amount,
      invoiceNumber: invoice.invoiceNumber,
      accountHolderName,
    })
  } catch (err) {
    console.error('[pay-ach] gateway error:', err)
    return NextResponse.json(
      { error: 'Payment gateway unreachable. Please try again.' },
      { status: 502 },
    )
  }

  if (!isApproved(result) || !result.retref) {
    return NextResponse.json(
      {
        error: result.resptext || 'ACH origination declined',
        respcode: result.respcode,
      },
      { status: 402 },
    )
  }

  // ── Persist Payment row as PENDING ────────────────────────────
  // LINCHPIN: PENDING does NOT advance the invoice/order. The
  // polling job in commit 4 walks this retref forward to CLEARED
  // (or RETURNED on NSF) over the next 1–2 business days.
  const persisted = await recordPortalPayment({
    invoiceId: invoice.id,
    portalAccessId: resolved.portalAccessId,
    amount,
    method: 'ACH' satisfies PaymentMethod,
    status: 'PENDING' satisfies PaymentStatus,
    gatewayRefId: result.retref,
    receivedAt: new Date(),
    reference: last4 ? `bank ····${last4}` : null,
    nachaAuthSignatureData: nachaSignatureData,
    nachaAuthText: nachaText,
    nachaAuthSignedAt: new Date(),
  })

  if (!persisted.ok) {
    // Gateway successfully originated but our DB write failed —
    // critical-edge case mirroring the card path. Log loudly so
    // billing can manually reconcile against the retref.
    console.error(
      '[pay-ach] CRITICAL: gateway originated retref=%s but DB write failed: %s',
      result.retref,
      persisted.error,
    )
    return NextResponse.json(
      {
        error:
          'Bank debit was authorized but we could not record the payment. Please contact billing@sirreel.com with this reference: ' +
          result.retref,
        retref: result.retref,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    paymentId: persisted.paymentId,
    invoice: persisted.invoice,
    // ACH never advances the order on origination. Explicit signal
    // to the UI so it can show "pending settlement" rather than a
    // generic "paid" success.
    pending: true,
    last4,
  })
}
