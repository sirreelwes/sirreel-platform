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
      extractedData: true,
      extractionConfidence: true,
      rfc822MessageId: true,
    },
  });
  if (!email) return NextResponse.json({ error: 'email not found' }, { status: 404 });

  // De-dupe on canonical message identity. Two failure modes we have to cover:
  //   (a) two concurrent clicks on the same suggestion — same emailMessageId
  //   (b) cross-inbox copies of the same RFC822 message — different
  //       emailMessageIds but the same rfc822MessageId
  // Check both. The DB-level partial unique index
  // `sr_inquiries_rfc822_gmail_uniq` is the backstop for races that slip
  // past this read (caught below as P2002).
  if (email.rfc822MessageId) {
    const byRfc = await prisma.inquiry.findFirst({
      where: { source: 'GMAIL', rfc822MessageId: email.rfc822MessageId },
      select: { id: true },
    });
    if (byRfc) return NextResponse.json({ inquiry: { id: byRfc.id }, deduped: true });
  }
  const byEmailId = await prisma.inquiry.findMany({
    select: { id: true, sourceMetadata: true },
    where: { source: 'GMAIL' },
  });
  const dupe = byEmailId.find((i) => {
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

  try {
    const inquiry = await prisma.inquiry.create({
      data: {
        title,
        description,
        source: 'GMAIL',
        status: 'NEW',
        companyId: email.companyId,
        personId: email.personId,
        assignedToId: userId,
        rfc822MessageId: email.rfc822MessageId,
        sourceMetadata: {
          emailMessageId: email.id,
          rfc822MessageId: email.rfc822MessageId,
          fromAddress: email.fromAddress,
          // Pre-extracted Quick Read fields. /orders/new-quote can read these
          // to pre-fill the quote builder and skip a duplicate AI call. Only
          // attached when confidence ≥ 0.5 (same threshold the slider uses).
          extractedData:
            email.extractedData && (email.extractionConfidence ?? 0) >= 0.5
              ? (email.extractedData as object)
              : null,
        },
      },
      select: { id: true },
    });
    return NextResponse.json({ inquiry });
  } catch (err) {
    // Partial unique violation on sr_inquiries_rfc822_gmail_uniq — another
    // request inserted the canonical row between our read and write. Treat
    // it as a dedup hit and return that row.
    const code = (err as { code?: string } | null)?.code;
    if (code === 'P2002' && email.rfc822MessageId) {
      const winner = await prisma.inquiry.findFirst({
        where: { source: 'GMAIL', rfc822MessageId: email.rfc822MessageId },
        select: { id: true },
      });
      if (winner) return NextResponse.json({ inquiry: { id: winner.id }, deduped: true });
    }
    throw err;
  }
}
