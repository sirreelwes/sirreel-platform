import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

// PATCH — agent action on a follow-up draft.
// Body: { action: 'send' | 'skip', subject?: string, body?: string }
// `send` records that the agent dispatched the follow-up (the actual mail-app
// open happens client-side via mailto:; when Gmail send is wired this route
// will also push the mail). `skip` dismisses without sending.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id || null;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action !== 'send' && action !== 'skip') {
    return NextResponse.json({ error: 'action must be "send" or "skip"' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.subject === 'string' && body.subject.trim()) data.draftSubject = body.subject;
  if (typeof body.body === 'string' && body.body.trim()) data.draftBody = body.body;

  if (action === 'send') {
    data.status = 'SENT';
    data.sentAt = new Date();
    data.sentById = userId;
  } else {
    data.status = 'SKIPPED';
    data.skippedAt = new Date();
    data.skippedById = userId;
  }

  try {
    const updated = await prisma.quoteFollowUp.update({ where: { id }, data });
    return NextResponse.json({ followUp: updated });
  } catch (e: any) {
    if (e?.code === 'P2025') return NextResponse.json({ error: 'not found' }, { status: 404 });
    throw e;
  }
}
