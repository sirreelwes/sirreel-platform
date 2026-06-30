import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { resolveDataScope } from '@/lib/auth/scope';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Open quotes for the sales pipeline — every quote SENT to a client but not
 * yet booked. Canonical definition: Order.quoteStatus = 'SENT' (the SENT
 * stage of OrderQuoteStatus: DRAFT → SENT → WON → LOST → EXPIRED — so this
 * excludes WON/booked, LOST, EXPIRED, and DRAFT), with the job not in a
 * terminal state (a WRAPPED/LOST job's leftover SENT order isn't a live
 * quote). Sorted by age — oldest sentAt first — so the most at-risk money is
 * on top. Honors scope=my|team. Returns ALL matches (not a top-N).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id || null;

  const dataScope = await resolveDataScope();
  const queryScope = req.nextUrl.searchParams.get('scope') === 'my' ? 'my' : 'team';
  const effectiveScope = dataScope.scope === 'OWN' ? 'my' : queryScope;
  const mine = effectiveScope === 'my' && userId ? userId : null;

  const orders = await prisma.order.findMany({
    where: {
      quoteStatus: 'SENT',
      job: { status: { notIn: ['WRAPPED', 'LOST'] } },
      ...(mine ? { agentId: mine } : {}),
    },
    // Stalest first. Nulls (a SENT order with no sentAt — shouldn't happen)
    // sort last so real, aged quotes stay on top.
    orderBy: { sentAt: { sort: 'asc', nulls: 'last' } },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      sentAt: true,
      company: { select: { id: true, name: true } },
      job: { select: { id: true, jobCode: true, name: true } },
      agent: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({
    scope: effectiveScope,
    quotes: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      total: Number(o.total),
      sentAt: o.sentAt,
      company: o.company,
      job: o.job,
      agent: o.agent,
    })),
  });
}
