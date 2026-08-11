import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/collections/charges — recent collections charges.
 *
 * Exists so an operator can see what they just took and reverse it. Without
 * this the charge history was write-only: a mis-keyed amount on a call had no
 * path back short of a database query.
 */

export async function GET() {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const rows = await prisma.rwCollectionCharge.findMany({
    orderBy: { chargedAt: 'desc' },
    take: 25,
    select: {
      id: true,
      invoiceNumber: true,
      customerName: true,
      amount: true,
      surchargeAmount: true,
      cardLast4: true,
      cardType: true,
      status: true,
      authCode: true,
      retref: true,
      chargedAt: true,
      reversedAt: true,
      reversalKind: true,
      reversalRetref: true,
      // The ledger — a charge may be partially refunded more than once, so
      // the single reversal_* columns above cannot tell the whole story.
      reversals: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, kind: true, retref: true, amount: true, reason: true, createdAt: true },
      },
    },
  })

  return NextResponse.json({
    ok: true,
    charges: rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      surchargeAmount: r.surchargeAmount == null ? 0 : Number(r.surchargeAmount),
      // What the card was actually debited — reversing returns this, not the
      // invoice-facing base.
      gatewayTotal: Number(r.amount) + Number(r.surchargeAmount ?? 0),
      reversals: r.reversals.map((v) => ({ ...v, amount: Number(v.amount) })),
      // What is left to reverse. Drives the UI: no button at zero, and a
      // partial input that cannot be set above this.
      reversedTotal: r.reversals.reduce((sum, v) => sum + Number(v.amount), 0),
    })),
  })
}
