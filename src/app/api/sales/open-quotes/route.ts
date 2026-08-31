import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { resolveDataScope } from '@/lib/auth/scope';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ACTIONABLE_ORDER_WHERE } from '@/lib/orders/actionableWhere';
import { compareByPickupUrgency } from '@/lib/sales/quoteUrgency';

export const dynamic = 'force-dynamic';

/**
 * Open quotes for the sales pipeline — every quote SENT to a client but not
 * yet booked. Canonical definition: Order.quoteStatus = 'SENT' (the SENT
 * stage of OrderQuoteStatus: DRAFT → SENT → WON → LOST → EXPIRED — so this
 * excludes WON/booked, LOST, EXPIRED, and DRAFT), with the job not in a
 * terminal state (a WRAPPED/LOST job's leftover SENT order isn't a live
 * quote). Honors scope=my|team. Returns ALL matches (not a top-N).
 *
 * Sorted by PICKUP URGENCY (Wes 2026-08-31), not by age. Age answers
 * "how long have we been waiting"; the pickup date answers "how long is
 * there left to win it", and only the second one decides what a rep
 * should open next. Ordering is by what is still winnable — past-pickup
 * quotes sort last, because a job that already went cannot be missed.
 * See compareByPickupUrgency in src/lib/sales/quoteUrgency.
 *
 * Also returns `pickupDate` — the order's own startDate when it has one,
 * else the earliest line-item pickup. That is the clock that decides
 * whether a quote is still winnable; `sentAt` only says how long we have
 * been waiting. See src/lib/sales/quoteUrgency.
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
      ...ACTIONABLE_ORDER_WHERE,
      ...(mine ? { agentId: mine } : {}),
    },
    // Stalest first here only as a STABLE TIE-BREAK. The real ordering is
    // by pickup urgency and happens below, in JS: it depends on the
    // effective pickup date, which can come from a line item, so Postgres
    // cannot express it in one ORDER BY.
    orderBy: { sentAt: { sort: 'asc', nulls: 'last' } },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      sentAt: true,
      startDate: true,
      company: { select: { id: true, name: true } },
      job: { select: { id: true, jobCode: true, name: true } },
      agent: { select: { id: true, name: true } },
      // Effective pickup falls back to the earliest scheduled line when
      // the order has no startDate of its own — measured 2026-08-31,
      // that was 4 of the 9 live quotes, so keying on the column alone
      // would blank the date on the rows most in need of a decision.
      lineItems: {
        select: { pickupDate: true },
        orderBy: { pickupDate: 'asc' },
        take: 1,
      },
    },
  });

  const quotes = orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      total: Number(o.total),
      sentAt: o.sentAt,
      /** Order's own start, else the first thing scheduled to leave. */
      pickupDate: o.startDate ?? o.lineItems[0]?.pickupDate ?? null,
      company: o.company,
      job: o.job,
      agent: o.agent,
  }));

  // Sorted after mapping, because the key is the EFFECTIVE pickup — the
  // order's own startDate or the earliest line's, resolved just above.
  quotes.sort((a, b) =>
    compareByPickupUrgency(
      { pickupDate: a.pickupDate ? new Date(a.pickupDate).toISOString() : null },
      { pickupDate: b.pickupDate ? new Date(b.pickupDate).toISOString() : null },
    ),
  );

  return NextResponse.json({ scope: effectiveScope, quotes });
}
