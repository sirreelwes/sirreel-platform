/**
 * GET /api/orders/[id]/follow-ups — Mode A cadence state for one order.
 *
 * Returns the cadence helper's output along with the small set of order
 * fields the panel needs for its display strip (sent date, valid-until,
 * stage history). The panel uses this to render the live cadence status
 * and decide whether the "Send follow-up" button highlights.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { CADENCE_STAGES, computeCadenceState, type CadenceStage } from '@/lib/sales/quoteCadence'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      quoteSentAt: true,
      expiresAt: true,
      quoteExpDays: true,
      followUps: {
        select: { stage: true, status: true, sentAt: true, sentById: true },
        orderBy: { sentAt: 'desc' },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  // Most-recent inbound on the order's mail thread (when one exists).
  // Single query: any EmailMessage for the order's company/thread that
  // arrived after quoteSentAt is enough to pause the cadence. Keep this
  // narrow — the panel only cares about a yes/no signal + timestamp.
  let threadLastInboundAt: Date | null = null
  if (order.quoteSentAt) {
    const orderRels = await prisma.order.findUnique({
      where: { id: params.id },
      select: { companyId: true, jobId: true },
    })
    if (orderRels?.companyId) {
      const latestInbound = await prisma.emailMessage.findFirst({
        where: {
          companyId: orderRels.companyId,
          direction: 'inbound',
          sentAt: { gt: order.quoteSentAt },
        },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      })
      threadLastInboundAt = latestInbound?.sentAt ?? null
    }
  }

  // Only STAGE_N rows count as Mode A history. Legacy DAY_X rows from
  // the cron live alongside but don't advance Mode A's state.
  const stagesSent: CadenceStage[] = order.followUps
    .filter((f) => f.status === 'SENT' && CADENCE_STAGES.includes(f.stage as CadenceStage))
    .map((f) => f.stage as CadenceStage)

  // Cross-system gating: if a legacy DAY_X has already been SENT for this
  // order, Mode A defers. The pipeline panel's mailto-driven send counts
  // as a real client touch, even though it goes out from the agent's
  // mail client rather than Resend.
  const legacySentExists = order.followUps.some(
    (f) => f.status === 'SENT' && (f.stage === 'DAY_0' || f.stage === 'DAY_1' || f.stage === 'DAY_3'),
  )

  const state = computeCadenceState({
    quoteSentAt: order.quoteSentAt,
    expiresAt: order.expiresAt,
    quoteExpDays: order.quoteExpDays,
    status: order.status,
    threadLastInboundAt,
    stagesSent,
    legacySentExists,
  })

  return NextResponse.json({
    orderId: order.id,
    quoteSentAt: order.quoteSentAt,
    effectiveExpiresAt: state.effectiveExpiresAt,
    threadLastInboundAt,
    state,
    history: order.followUps,
  })
}
