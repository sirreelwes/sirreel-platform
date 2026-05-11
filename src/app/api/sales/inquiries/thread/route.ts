import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Returns the full email thread for a given inquiry-suggestion email, so
// the Inquiries drawer can render every message instead of just the latest
// snippet. Also reports whether that email has already been captured or
// dismissed so the drawer footer can pick the right CTA.
//
// Query: ?emailId=<EmailMessage.id>
// Response: {
//   email: { id, subject, threadId },
//   thread: { id, subject, lastDirection } | null,
//   messages: [{ id, fromAddress, toAddresses, subject, snippet, direction, sentAt }],
//   considered: { inquiryId, status } | null,
// }
export async function GET(req: NextRequest) {
  const emailId = req.nextUrl.searchParams.get('emailId') || '';
  if (!emailId) return NextResponse.json({ error: 'emailId required' }, { status: 400 });

  const email = await prisma.emailMessage.findUnique({
    where: { id: emailId },
    select: { id: true, subject: true, threadId: true, fromAddress: true },
  });
  if (!email) return NextResponse.json({ error: 'email not found' }, { status: 404 });

  let thread: { id: string; subject: string | null; lastDirection: string | null } | null = null;
  let messages: Array<{
    id: string;
    fromAddress: string;
    toAddresses: string[];
    subject: string;
    snippet: string | null;
    direction: string;
    sentAt: Date;
  }> = [];

  if (email.threadId) {
    const [t, msgs] = await Promise.all([
      prisma.emailThread.findUnique({
        where: { id: email.threadId },
        select: { id: true, subject: true, lastDirection: true },
      }),
      prisma.emailMessage.findMany({
        where: { threadId: email.threadId },
        orderBy: { sentAt: 'asc' },
        select: {
          id: true,
          fromAddress: true,
          toAddresses: true,
          subject: true,
          snippet: true,
          direction: true,
          sentAt: true,
        },
      }),
    ]);
    thread = t;
    messages = msgs;
  } else {
    // No thread — just return the single message.
    const single = await prisma.emailMessage.findUnique({
      where: { id: email.id },
      select: {
        id: true,
        fromAddress: true,
        toAddresses: true,
        subject: true,
        snippet: true,
        direction: true,
        sentAt: true,
      },
    });
    if (single) messages = [single];
  }

  // Has this email been captured or dismissed? Match on sourceMetadata.emailMessageId.
  const considered = await prisma.inquiry.findMany({
    select: { id: true, status: true, sourceMetadata: true },
  });
  const match = considered.find((i) => {
    const meta = i.sourceMetadata as Record<string, unknown> | null;
    return meta?.emailMessageId === email.id;
  });

  return NextResponse.json({
    email: { id: email.id, subject: email.subject, threadId: email.threadId },
    thread,
    messages,
    considered: match ? { inquiryId: match.id, status: match.status } : null,
  });
}
