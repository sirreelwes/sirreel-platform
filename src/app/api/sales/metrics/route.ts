import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Funnel metrics for the sales pipeline page. Compares MTD vs prior month.
// Honors `scope=my|team`.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id || null;

  const scope = req.nextUrl.searchParams.get('scope') === 'my' ? 'my' : 'team';
  const mine = scope === 'my' && userId ? userId : null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // End of prev month = start of this month (exclusive upper bound).

  const [
    inquiriesNew,
    inquiriesConvertedThisMonth,
    inquiriesNewLastMonth,
    inquiriesConvertedLastMonth,
    quotesSentThisMonth,
    wonThisMonth,
    wonLastMonth,
    topOpenDeals,
  ] = await Promise.all([
    prisma.inquiry.count({
      where: {
        createdAt: { gte: monthStart },
        ...(mine ? { assignedToId: mine } : {}),
      },
    }),
    prisma.inquiry.count({
      where: {
        status: 'CONVERTED',
        updatedAt: { gte: monthStart },
        ...(mine ? { assignedToId: mine } : {}),
      },
    }),
    prisma.inquiry.count({
      where: {
        createdAt: { gte: prevMonthStart, lt: monthStart },
        ...(mine ? { assignedToId: mine } : {}),
      },
    }),
    prisma.inquiry.count({
      where: {
        status: 'CONVERTED',
        updatedAt: { gte: prevMonthStart, lt: monthStart },
        ...(mine ? { assignedToId: mine } : {}),
      },
    }),
    prisma.order.count({
      where: {
        sentAt: { gte: monthStart },
        ...(mine ? { agentId: mine } : {}),
      },
    }),
    prisma.order.aggregate({
      where: {
        wonAt: { gte: monthStart },
        ...(mine ? { agentId: mine } : {}),
      },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: {
        wonAt: { gte: prevMonthStart, lt: monthStart },
        ...(mine ? { agentId: mine } : {}),
      },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.order.findMany({
      where: {
        quoteStatus: 'SENT',
        ...(mine ? { agentId: mine } : {}),
      },
      orderBy: { total: 'desc' },
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        total: true,
        sentAt: true,
        company: { select: { id: true, name: true } },
        job: { select: { id: true, jobCode: true, name: true } },
        agent: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Conversion rate: inquiries that converted, divided by inquiries opened in the same window.
  const conversionRate = inquiriesNew > 0 ? inquiriesConvertedThisMonth / inquiriesNew : null;
  const conversionRatePrev =
    inquiriesNewLastMonth > 0 ? inquiriesConvertedLastMonth / inquiriesNewLastMonth : null;

  const wonTotal = Number(wonThisMonth._sum.total ?? 0);
  const wonTotalPrev = Number(wonLastMonth._sum.total ?? 0);
  const wonDelta =
    wonTotalPrev > 0 ? (wonTotal - wonTotalPrev) / wonTotalPrev : wonTotal > 0 ? 1 : null;

  return NextResponse.json({
    scope,
    period: { start: monthStart.toISOString(), label: monthLabel(monthStart) },
    inquiriesNew,
    inquiriesNewLastMonth,
    inquiriesConvertedThisMonth,
    quotesSentThisMonth,
    conversionRate,
    conversionRatePrev,
    wonCount: wonThisMonth._count._all,
    wonTotal,
    wonTotalPrev,
    wonDelta,
    topOpenDeals: topOpenDeals.map((o) => ({
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

function monthLabel(d: Date) {
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}
