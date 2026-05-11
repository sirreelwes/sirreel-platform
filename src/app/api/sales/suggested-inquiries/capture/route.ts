import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildThreadText } from '@/lib/email/thread-text';

export const dynamic = 'force-dynamic';

// Captures an inbound email as an Inquiry. If the email belongs to a
// thread (most do), aggregates every message on the thread —
// quote-stripped, chronological — into Inquiry.description so the AI
// parser sees the full negotiation context, not a single snippet of
// the most recent reply. Marks the source so this email won't keep
// surfacing as a suggestion.
//
// Body: { emailId: string }
// Returns: { inquiry: { id, ... } }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id || null;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const emailId = typeof body.emailId === 'string' ? body.emailId : '';
  if (!emailId) return NextResponse.json({ error: 'emailId required' }, { status: 400 });

  const email = await prisma.emailMessage.findUnique({
    where: { id: emailId },
    select: {
      id: true,
      subject: true,
      snippet: true,
      bodyText: true,
      fromAddress: true,
      sentAt: true,
      direction: true,
      threadId: true,
      companyId: true,
      personId: true,
    },
  });
  if (!email) return NextResponse.json({ error: 'email not found' }, { status: 404 });

  // De-dupe: if we already have an Inquiry from this email, return it.
  const existing = await prisma.inquiry.findMany({
    select: { id: true, status: true, sourceMetadata: true },
  });
  const dupe = existing.find((i) => {
    const meta = i.sourceMetadata as Record<string, unknown> | null;
    return meta?.emailMessageId === email.id;
  });
  if (dupe) {
    return NextResponse.json({ inquiry: { id: dupe.id }, deduped: true });
  }

  const title = (email.subject || 'Inquiry from email').slice(0, 200);

  // Build the description: full thread transcript when a thread exists,
  // single-message body (or snippet) otherwise. Single-message threads
  // produce a transcript with exactly one block — degenerate-equal to
  // the prior snippet-only behavior except now using the full body when
  // available.
  let description: string;
  if (email.threadId) {
    const threadMessages = await prisma.emailMessage.findMany({
      where: { threadId: email.threadId },
      orderBy: { sentAt: 'asc' },
      select: {
        fromAddress: true,
        direction: true,
        sentAt: true,
        bodyText: true,
        snippet: true,
      },
    });
    description = buildThreadText(threadMessages);
  } else {
    description = buildThreadText([
      {
        fromAddress: email.fromAddress,
        direction: email.direction,
        sentAt: email.sentAt,
        bodyText: email.bodyText,
        snippet: email.snippet,
      },
    ]);
  }
  // Fall back to whatever we have if the transcript came out empty.
  if (!description) {
    description = (email.bodyText || email.snippet || email.subject || '').slice(0, 32_000);
  }

  const inquiry = await prisma.inquiry.create({
    data: {
      title,
      description,
      source: 'GMAIL',
      status: 'NEW',
      companyId: email.companyId,
      personId: email.personId,
      assignedToId: userId,
      sourceMetadata: { emailMessageId: email.id, fromAddress: email.fromAddress },
    },
    select: { id: true },
  });

  return NextResponse.json({ inquiry });
}
