import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveDataScope } from '@/lib/auth/scope';

export const dynamic = 'force-dynamic';

// Lists pending (and recently-acted) follow-up drafts for the panel above
// Open Quotes. `scope=my` filters to drafts whose order belongs to the
// signed-in agent.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id || null;

  // Phase 6.5 — server-side data scope. OWN users always get `my`.
  const dataScope = await resolveDataScope();
  const queryScope = req.nextUrl.searchParams.get('scope') === 'my' ? 'my' : 'team';
  const effectiveScope = dataScope.scope === 'OWN' ? 'my' : queryScope;
  const mine = effectiveScope === 'my' && userId ? userId : null;

  const followUps = await prisma.quoteFollowUp.findMany({
    where: {
      status: 'PENDING',
      // Cross-system gating: hide legacy PENDING rows for orders that
      // already received a Mode A STAGE_X send. Mode A is the canonical
      // surface for those orders — the agent acted there and shouldn't
      // see a stale DAY_X prompt in the pipeline panel afterward.
      order: {
        ...(mine ? { agentId: mine } : {}),
        followUps: {
          none: {
            status: 'SENT',
            stage: { in: ['STAGE_1', 'STAGE_2', 'STAGE_3'] },
          },
        },
      },
    },
    orderBy: [{ dueAt: 'asc' }],
    take: 50,
    select: {
      id: true,
      stage: true,
      status: true,
      dueAt: true,
      draftSubject: true,
      draftBody: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          total: true,
          sentAt: true,
          company: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true } },
          job: { select: { id: true, jobCode: true, name: true } },
          jobContact: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      },
    },
  });

  return NextResponse.json({
    scope: effectiveScope,
    followUps: followUps.map((f) => ({
      ...f,
      order: { ...f.order, total: Number(f.order.total) },
    })),
  });
}
