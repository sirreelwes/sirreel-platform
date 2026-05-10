import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const ALLOWED_REASONS = new Set([
  'Other vendor',
  'Budget',
  'No response',
  'Timing',
  'Other',
]);

// POST — reclassify a job as LOST. Sets Job.status = LOST and marks every
// non-terminal Order on the job as LOST with the same reason. Pending
// follow-up drafts on those orders are expired. Write-once on lostAt.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id || null;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!ALLOWED_REASONS.has(reason)) {
    return NextResponse.json(
      { error: 'reason must be one of: ' + Array.from(ALLOWED_REASONS).join(', ') },
      { status: 400 },
    );
  }

  const job = await prisma.job.findUnique({ where: { id }, select: { id: true } });
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Mark the job itself as LOST.
    await tx.job.update({ where: { id }, data: { status: 'LOST' } });

    // Mark every non-terminal order quoteStatus as LOST. WON orders are left alone.
    const openOrders = await tx.order.findMany({
      where: { jobId: id, quoteStatus: { in: ['DRAFT', 'SENT'] } },
      select: { id: true, lostAt: true },
    });
    for (const o of openOrders) {
      await tx.order.update({
        where: { id: o.id },
        data: {
          quoteStatus: 'LOST',
          lostReason: reason,
          lostAt: o.lostAt ?? now,
        },
      });
    }

    // Expire any pending follow-up drafts for those orders.
    await tx.quoteFollowUp.updateMany({
      where: { orderId: { in: openOrders.map((o) => o.id) }, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
  });

  return NextResponse.json({ ok: true, reason });
}
