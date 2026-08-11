import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import { reverseCardCharge } from '@/lib/cardpointe/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/collections/charges/[id]/reverse — undo a collections charge.
 *
 * reverseCardCharge tries a VOID first and falls back to a REFUND if the
 * transaction has already settled. The gateway decides which is possible; we
 * record which actually happened, because they are not equivalent to a
 * client — a void never appears on their statement, a refund appears as a
 * separate credit days later, and that difference drives the phone call.
 *
 * Reverses the FULL gateway amount by default (base + surcharge), because
 * that is what the card was debited. Refunding only the base would silently
 * keep the 3% fee, which is the kind of thing that turns a goodwill gesture
 * into a complaint. A partial `amount` may be supplied for a partial refund.
 *
 * Only APPROVED, not-yet-reversed charges can be reversed — reversing a
 * decline is meaningless and double-reversing risks a duplicate credit.
 */

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown; amount?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  if (reason.length < 4) {
    return NextResponse.json(
      { ok: false, error: 'A reason of at least 4 characters is required.' },
      { status: 400 },
    )
  }

  const charge = await prisma.rwCollectionCharge.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      retref: true,
      status: true,
      amount: true,
      surchargeAmount: true,
      reversedAt: true,
    },
  })
  if (!charge) return NextResponse.json({ ok: false, error: 'charge not found' }, { status: 404 })
  if (charge.status !== 'APPROVED') {
    return NextResponse.json(
      { ok: false, error: `only approved charges can be reversed (this one is ${charge.status})` },
      { status: 409 },
    )
  }
  // How much has ALREADY been returned. Read from the ledger, because a
  // charge can be reversed more than once: two $5 refunds against a $9.27
  // charge must not both succeed.
  const prior = await prisma.rwCollectionReversal.aggregate({
    where: { chargeId: charge.id },
    _sum: { amount: true },
  })
  const alreadyReversed = Number(prior._sum.amount ?? 0)
  if (!charge.retref) {
    return NextResponse.json(
      { ok: false, error: 'no gateway reference on that charge — cannot reverse' },
      { status: 409 },
    )
  }

  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
  const gatewayTotal = round(Number(charge.amount) + Number(charge.surchargeAmount ?? 0))
  const remaining = round(gatewayTotal - alreadyReversed)

  if (remaining <= 0) {
    return NextResponse.json(
      { ok: false, error: 'that charge has already been fully reversed' },
      { status: 409 },
    )
  }

  // An explicit amount is a PARTIAL refund. Absent one, reverse what is left.
  const requested = Number(body.amount)
  const wantsPartial = Number.isFinite(requested) && requested > 0 && round(requested) < remaining
  const amountDollars = wantsPartial ? round(requested) : remaining

  // Refusing to over-refund is the whole point of the ledger: the gateway
  // will happily return more than was taken if asked repeatedly.
  if (Number.isFinite(requested) && requested > 0 && round(requested) > remaining) {
    return NextResponse.json(
      {
        ok: false,
        error: `only $${remaining.toFixed(2)} remains on that charge (of $${gatewayTotal.toFixed(2)}).`,
      },
      { status: 400 },
    )
  }

  const result = await reverseCardCharge({
    retref: charge.retref,
    amountDollars,
    // Anything less than the FULL original amount must not attempt a void —
    // a void ignores the amount and annuls everything.
    partial: amountDollars < gatewayTotal,
  })

  if (!result.ok) {
    console.error(`[collections] reverse failed for ${charge.id}: ${result.message}`)
    return NextResponse.json({ ok: false, error: result.message }, { status: 502 })
  }

  const kind = result.kind === 'void' ? 'VOID' : 'REFUND'
  await prisma.rwCollectionReversal.create({
    data: {
      chargeId: charge.id,
      kind,
      retref: result.retref ?? null,
      amount: amountDollars,
      reason,
      createdById: user.id,
    },
  })
  // Legacy summary columns, kept in step so anything still reading them sees
  // the latest reversal. The ledger above is the source of truth.
  await prisma.rwCollectionCharge.update({
    where: { id: charge.id },
    data: {
      reversedAt: new Date(),
      reversalKind: kind,
      reversalRetref: result.retref ?? null,
      reversalAmount: amountDollars,
      reversalReason: reason,
      reversedById: user.id,
    },
  })

  return NextResponse.json({
    ok: true,
    kind: result.kind,
    retref: result.retref,
    amount: amountDollars,
    remaining: round(remaining - amountDollars),
    message:
      result.kind === 'void'
        ? `Voided $${amountDollars.toFixed(2)} — it will not appear on the client's statement.`
        : `Refunded $${amountDollars.toFixed(2)} — it will appear as a credit in a few days.` +
          (round(remaining - amountDollars) > 0
            ? ` $${round(remaining - amountDollars).toFixed(2)} of this charge remains.`
            : ''),
  })
}
