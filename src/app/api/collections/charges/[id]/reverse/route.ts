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
  if (charge.reversedAt) {
    return NextResponse.json(
      { ok: false, error: 'that charge has already been reversed' },
      { status: 409 },
    )
  }
  if (!charge.retref) {
    return NextResponse.json(
      { ok: false, error: 'no gateway reference on that charge — cannot reverse' },
      { status: 409 },
    )
  }

  const gatewayTotal = Number(charge.amount) + Number(charge.surchargeAmount ?? 0)
  const requested = Number(body.amount)
  const amountDollars =
    Number.isFinite(requested) && requested > 0 && requested < gatewayTotal
      ? requested
      : gatewayTotal

  const result = await reverseCardCharge({ retref: charge.retref, amountDollars })

  if (!result.ok) {
    console.error(`[collections] reverse failed for ${charge.id}: ${result.message}`)
    return NextResponse.json({ ok: false, error: result.message }, { status: 502 })
  }

  await prisma.rwCollectionCharge.update({
    where: { id: charge.id },
    data: {
      reversedAt: new Date(),
      reversalKind: result.kind === 'void' ? 'VOID' : 'REFUND',
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
    message:
      result.kind === 'void'
        ? `Voided $${amountDollars.toFixed(2)} — it will not appear on the client's statement.`
        : `Refunded $${amountDollars.toFixed(2)} — it will appear as a credit in a few days.`,
  })
}
