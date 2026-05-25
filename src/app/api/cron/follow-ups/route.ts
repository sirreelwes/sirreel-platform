import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { FollowUpStage } from '@prisma/client';
import { composeDraft, computeDueAt } from '@/lib/sales/followUpDraft';

export const dynamic = 'force-dynamic';

const STAGES: FollowUpStage[] = ['DAY_0', 'DAY_1', 'DAY_3'];
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
      // Don't draft follow-ups for orders whose parent Job is
      // already WRAPPED/LOST — those quotes are residue from a
      // closed deal; chasing them with cadence emails is noise.
      job: { status: { notIn: ['WRAPPED', 'LOST'] } },
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
