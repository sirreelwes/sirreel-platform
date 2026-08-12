/**
 * GET /api/public/pay-details/[token] — payment details for a scoped share
 * link, read by a client's accounts-payable team.
 *
 * The token IS the credential: 24 random bytes, unguessable, revocable, and
 * scoped to payment details alone. It grants no portal access — no
 * agreements, invoices, or card authorization.
 *
 * Deliberately NOT rate-limited by IP: a large A/P department behind one
 * office NAT may open the same link several times, and locking them out
 * pushes them back to asking for the numbers by email — the exact behaviour
 * this exists to prevent. Guessing is bounded by the token's entropy, not by
 * a request counter.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = (params.token || '').trim()
  // Uniform response for every failure — expired, revoked, never existed.
  // Distinguishing them would confirm which tokens are real.
  const gone = NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 404 })
  if (!/^[a-f0-9]{16,96}$/.test(token)) return gone

  const share = await prisma.paymentDetailsShare.findUnique({
    where: { token },
    select: { id: true, expiresAt: true, revokedAt: true },
  })
  if (!share || share.revokedAt || share.expiresAt < new Date()) return gone

  const s = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: {
      paymentPayeeName: true,
      paymentBankName: true,
      paymentAccountType: true,
      paymentAccountNumber: true,
      paymentRoutingAch: true,
      paymentRoutingWire: true,
      paymentRemittanceEmail: true,
      paymentBankAddress: true,
      paymentInstructions: true,
      paymentZelleHandle: true,
      paymentZelleName: true,
      paymentAchFormKey: true,
      paymentAchFormFilename: true,
      paymentBankInfoKey: true,
      paymentBankInfoFilename: true,
    },
  })
  if (!s?.paymentPayeeName || !s?.paymentAccountNumber || !s?.paymentRoutingAch) {
    return NextResponse.json({ ok: false, reason: 'unconfigured' }, { status: 503 })
  }

  // Best-effort: a view that fails to record must never block the read. An
  // A/P department that cannot see the details will go looking in email.
  // COALESCE so first_viewed_at stamps once and never moves; Prisma cannot
  // express "set only if null" in a single update.
  prisma
    .$executeRaw`UPDATE sr_payment_details_shares
       SET view_count = view_count + 1,
           first_viewed_at = COALESCE(first_viewed_at, NOW())
       WHERE id = ${share.id}`
    .catch(() => {})

  return NextResponse.json({
    ok: true,
    details: {
      payeeName: s.paymentPayeeName,
      bankName: s.paymentBankName ?? null,
      accountType: s.paymentAccountType ?? null,
      accountNumber: s.paymentAccountNumber,
      routingAch: s.paymentRoutingAch,
      routingWire: s.paymentRoutingWire ?? null,
      remittanceEmail: s.paymentRemittanceEmail ?? null,
      bankAddress: s.paymentBankAddress ?? null,
      instructions: s.paymentInstructions ?? null,
      zelleHandle: s.paymentZelleHandle ?? null,
      zelleName: s.paymentZelleName ?? null,
    },
    // Presence + display name only. The blob keys never leave the server;
    // the files are fetched through the doc route, behind this same token.
    documents: [
      s.paymentAchFormKey
        ? { slot: 'ach-form', label: s.paymentAchFormFilename || 'ACH authorization form' }
        : null,
      s.paymentBankInfoKey
        ? { slot: 'bank-info', label: s.paymentBankInfoFilename || 'Bank information letter' }
        : null,
    ].filter(Boolean),
  })
}
