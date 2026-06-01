import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveDataScope } from '@/lib/auth/scope';

export const dynamic = 'force-dynamic';

const STALE_QUOTE_DAYS = 5;
const DORMANT_CLIENT_DAYS = 60;

// Returns four buckets of opportunities the sales team should act on.
// Honors the same `scope=my|team` toggle the pipeline page uses.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id || null;

  // Phase 6.5 — server-side data scope. OWN users always get `my`.
  const dataScope = await resolveDataScope();
  const queryScope = req.nextUrl.searchParams.get('scope') === 'my' ? 'my' : 'team';
  const effectiveScope = dataScope.scope === 'OWN' ? 'my' : queryScope;
  const mine = effectiveScope === 'my' && userId ? userId : null;

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_QUOTE_DAYS * 86400000);
  const dormantCutoff = new Date(now.getTime() - DORMANT_CLIENT_DAYS * 86400000);

  const [staleQuotes, pendingCoi, unlinkedEmailCount, dormantBookings] = await Promise.all([
    prisma.order.findMany({
      where: {
        quoteStatus: 'SENT',
        sentAt: { lt: staleCutoff },
        // Same WRAPPED/LOST guard as topOpenDeals — a closed Job's
        // stale quote isn't actionable anymore; the deal's already
        // resolved on the Job side, the leftover SENT quote is
        // residue.
        job: { status: { notIn: ['WRAPPED', 'LOST'] } },
        ...(mine ? { agentId: mine } : {}),
      },
      orderBy: { sentAt: 'asc' },
      take: 25,
      select: {
        id: true,
        orderNumber: true,
        total: true,
        sentAt: true,
        company: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        job: { select: { id: true, jobCode: true, name: true } },
      },
    }),
    prisma.coiCheck.findMany({
      where: { humanDecision: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 25,
      select: {
        id: true,
        createdAt: true,
        company: { select: { id: true, name: true } },
        job: { select: { id: true, jobCode: true, name: true } },
      },
    }),
    prisma.emailMessage.count({
      where: {
        direction: 'inbound',
        companyId: null,
        personId: null,
        status: { notIn: ['ARCHIVED', 'RESOLVED'] },
      },
    }),
    // Group bookings by company to get the most recent returnedAt per company.
    prisma.booking.groupBy({
      by: ['companyId'],
      where: { status: 'RETURNED', returnedAt: { not: null } },
      _max: { returnedAt: true },
    }),
  ]);

  // Filter dormant client candidates: latest return < dormantCutoff.
  const dormantCompanyIds = dormantBookings
    .filter((b) => b._max.returnedAt && b._max.returnedAt < dormantCutoff)
    .map((b) => b.companyId);

  // Exclude companies that already have an active or quoted job to avoid noise.
  let dormantClients: Array<{
    id: string;
    name: string;
    lastReturnedAt: Date | null;
    defaultAgent: { id: string; name: string } | null;
  }> = [];
  if (dormantCompanyIds.length > 0) {
    const activeJobCompanies = await prisma.job.findMany({
      where: {
        companyId: { in: dormantCompanyIds },
        status: { in: ['QUOTED', 'ACTIVE'] },
      },
      select: { companyId: true },
    });
    const activeSet = new Set(activeJobCompanies.map((j) => j.companyId));
    const dormantCandidates = dormantCompanyIds.filter((id) => !activeSet.has(id));

    if (dormantCandidates.length > 0) {
      const companies = await prisma.company.findMany({
        where: {
          id: { in: dormantCandidates },
          ...(mine ? { defaultAgentId: mine } : {}),
        },
        select: {
          id: true,
          name: true,
          defaultAgent: { select: { id: true, name: true } },
        },
        take: 25,
      });
      const lastReturnedById = new Map(dormantBookings.map((b) => [b.companyId, b._max.returnedAt]));
      dormantClients = companies
        .map((c) => ({
          id: c.id,
          name: c.name,
          lastReturnedAt: lastReturnedById.get(c.id) ?? null,
          defaultAgent: c.defaultAgent,
        }))
        .sort((a, b) => {
          const av = a.lastReturnedAt?.getTime() ?? 0;
          const bv = b.lastReturnedAt?.getTime() ?? 0;
          return av - bv;
        });
    }
  }

  return NextResponse.json({
    scope: effectiveScope,
    staleQuotes: staleQuotes.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      total: Number(o.total),
      sentAt: o.sentAt,
      job: o.job,
      company: o.company,
      agent: o.agent,
      daysSinceSent: o.sentAt
        ? Math.floor((now.getTime() - o.sentAt.getTime()) / 86400000)
        : null,
    })),
    pendingCoi: pendingCoi.map((c) => ({
      id: c.id,
      createdAt: c.createdAt,
      company: c.company,
      job: c.job,
    })),
    unlinkedEmailCount,
    dormantClients,
  });
}
