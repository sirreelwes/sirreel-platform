import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { clientPaymentBehavior } from '@/lib/payments/clientPaymentBehavior'

export const dynamic = 'force-dynamic'

/**
 * GET /api/crm/companies/[id]/payment-behavior — how this client pays.
 *
 * Joins the HQ Company to RW history by exact case-insensitive name — the
 * only key that exists until RW retires. When the names differ (DBA vs legal
 * name), the result is honestly empty rather than fuzzily wrong; the card
 * says which name it looked under so a mismatch is diagnosable at a glance.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { name: true },
  })
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const behavior = await clientPaymentBehavior([company.name])
  const b = behavior.get(company.name.trim().toLowerCase()) ?? null

  return NextResponse.json({
    ok: true,
    lookedUpAs: company.name,
    behavior: b && {
      openCount: b.openCount,
      openTotal: b.openTotal,
      oldestOpenDays: b.oldestOpenDays,
      observedPayments: b.observedPayments,
      avgDaysToPay: b.avgDaysToPay,
      medianDaysToPay: b.medianDaysToPay,
      lastPaidAt: b.lastPaidAt,
      preTrackingPayments: b.preTrackingPayments,
    },
  })
}
