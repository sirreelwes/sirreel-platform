import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const LOOKBACK_DAYS = 14;
const PAGE_SIZE = 12;

// Inbound emails that look like inquiries and haven't been considered yet.
// "Considered" = either captured (Inquiry created from this email) or
// dismissed (placeholder Inquiry with status=DISMISSED). Both record the
// email's id under sourceMetadata.emailMessageId.
export async function GET() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  const [emails, considered] = await Promise.all([
    prisma.emailMessage.findMany({
      where: {
        direction: 'inbound',
        category: { in: ['BOOKING_INQUIRY', 'RENTAL_REQUEST'] },
        sentAt: { gte: since },
      },
      orderBy: { sentAt: 'desc' },
      take: 50,
      select: {
        id: true,
        fromAddress: true,
        subject: true,
        snippet: true,
        sentAt: true,
        category: true,
        company: { select: { id: true, name: true } },
        person: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
    // Small dataset; just fetch all and filter in JS to dodge Prisma JSON-null
    // semantics that differ from regular `not: null`.
    prisma.inquiry.findMany({
      select: { sourceMetadata: true, status: true, id: true },
    }),
  ]);

  const consideredMap = new Map<string, { inquiryId: string; status: string }>();
  for (const i of considered) {
    const meta = i.sourceMetadata as Record<string, unknown> | null;
    const emailId = meta?.emailMessageId;
    if (typeof emailId === 'string') {
      consideredMap.set(emailId, { inquiryId: i.id, status: i.status });
    }
  }

  const suggestions = emails
    .filter((e) => !consideredMap.has(e.id))
    .slice(0, PAGE_SIZE)
    .map((e) => ({
      emailId: e.id,
      fromAddress: e.fromAddress,
      subject: e.subject,
      snippet: e.snippet,
      sentAt: e.sentAt,
      category: e.category,
      company: e.company,
      person: e.person,
    }));

  return NextResponse.json({
    suggestions,
    totalCandidates: emails.length,
    consideredCount: consideredMap.size,
  });
}
