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
    })),
  })
}
