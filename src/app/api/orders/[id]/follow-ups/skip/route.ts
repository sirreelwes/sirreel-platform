/**
 * POST /api/orders/[id]/follow-ups/skip
 *
 * Marks the soonest PENDING QuoteFollowUp row for this order as
 * SKIPPED (the schema enum already supports this — agents have been
 * able to set it via direct DB writes only until now). Stamps
 * `skippedAt` + `skippedById` so the audit shows who dismissed.
 *
 * Body: {} — no fields. Stage resolves to the soonest-due PENDING
 * row, matching the way the cadence column is presented to the agent.
 *
 * Refuses when:
 *   - no PENDING follow-up row exists (nothing to skip)
 *   - the order doesn't exist
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!order) return bad(404, 'order not found')

  const pending = await prisma.quoteFollowUp.findFirst({
    where: { orderId: params.id, status: 'PENDING' },
    orderBy: { dueAt: 'asc' },
    select: { id: true, stage: true },
  })
  if (!pending) return bad(400, 'no PENDING follow-up to skip')

  const userRow = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

  await prisma.quoteFollowUp.update({
    where: { id: pending.id },
    data: {
      status: 'SKIPPED',
      skippedAt: new Date(),
      skippedById: userRow?.id ?? null,
    },
  })

  return NextResponse.json({ ok: true, stage: pending.stage })
}
