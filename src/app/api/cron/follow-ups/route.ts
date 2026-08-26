import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ACTIONABLE_ORDER_WHERE } from '@/lib/orders/actionableWhere';
import { composeDraft, computeDueAt } from '@/lib/sales/followUpDraft';

export const dynamic = 'force-dynamic';

// Legacy cron stages. STAGE_1/2/3 belong to the Mode A agent-driven
// flow (src/lib/sales/quoteCadence.ts) and are NOT auto-created here.
type LegacyStage = 'DAY_0' | 'DAY_1' | 'DAY_3';
const STAGES: LegacyStage[] = ['DAY_0', 'DAY_1', 'DAY_3'];
const BATCH_SIZE = 200;

// Hourly cron — generates QuoteFollowUp draft rows for any SENT order that has
// crossed a cadence threshold but doesn't yet have a row for that stage. Also
// expires existing PENDING rows whose order has since left the SENT state.
//
// Vercel Cron auth: pass `Authorization: Bearer ${CRON_SECRET}` if the env var
// is set; if not set, the route is open (useful for local manual runs).
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const earliestThreshold = new Date(now.getTime() - 8 * 3_600_000);

  const orders = await prisma.order.findMany({
    where: {
      quoteStatus: 'SENT',
      sentAt: { not: null, lte: earliestThreshold },
      // Don't draft follow-ups for a closed deal's residue, or for an
      // order staff archived. Note this does NOT expire drafts that
      // already exist on an archived order: nothing auto-sends them (a
      // human sends from the order page), and expiring them would make
      // unarchive lossy — QuoteFollowUp is unique on (orderId, stage),
      // so an expired row permanently blocks its own replacement. They
      // just stop being listed; see /api/sales/follow-ups.
      ...ACTIONABLE_ORDER_WHERE,
    },
    take: BATCH_SIZE,
    select: {
      id: true,
      sentAt: true,
      job: { select: { jobCode: true, name: true } },
      company: { select: { name: true } },
      agent: { select: { name: true } },
      followUps: { select: { stage: true } },
    },
  });

  let created = 0;
  for (const o of orders) {
    if (!o.sentAt) continue;
    const existing = new Set(o.followUps.map((f) => f.stage));
    for (const stage of STAGES) {
      if (existing.has(stage)) continue;
      const dueAt = computeDueAt(o.sentAt, stage);
      if (dueAt > now) continue;

      const draft = composeDraft(stage, {
        agentName: o.agent.name,
        jobName: o.job.name,
        jobCode: o.job.jobCode,
        companyName: o.company.name,
      });

      try {
        await prisma.quoteFollowUp.create({
          data: {
            orderId: o.id,
            stage,
            dueAt,
            draftSubject: draft.subject,
            draftBody: draft.body,
          },
        });
        created++;
      } catch (e: any) {
        // P2002 = unique violation — another cron pass got there first. Skip.
        if (e?.code !== 'P2002') throw e;
      }
    }
  }

  // Expire PENDING follow-ups whose orders are no longer SENT, OR
  // whose parent Job has reached a terminal state (WRAPPED/LOST).
  // The second branch sweeps any existing follow-ups that were
  // drafted before the Job closed but never got an Order.quoteStatus
  // mutation to trip the first branch.
  const expired = await prisma.quoteFollowUp.updateMany({
    where: {
      status: 'PENDING',
      OR: [
        { order: { quoteStatus: { not: 'SENT' } } },
        { order: { job: { status: { in: ['WRAPPED', 'LOST'] } } } },
      ],
    },
    data: { status: 'EXPIRED' },
  });

  return NextResponse.json({
    now: now.toISOString(),
    scannedOrders: orders.length,
    created,
    expired: expired.count,
  });
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${secret}`;
}
