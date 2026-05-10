import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Lists pending (and recently-acted) follow-up drafts for the panel above
// Open Quotes. `scope=my` filters to drafts whose order belongs to the
// signed-in agent.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id || null;

  const scope = req.nextUrl.searchParams.get('scope') === 'my' ? 'my' : 'team';
  const mine = scope === 'my' && userId ? userId : null;

  const followUps = await prisma.quoteFollowUp.findMany({
    where: {
      status: 'PENDING',
      ...(mine ? { order: { agentId: mine } } : {}),
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
    scope,
    followUps: followUps.map((f) => ({
      ...f,
      order: { ...f.order, total: Number(f.order.total) },
    })),
  });
}
