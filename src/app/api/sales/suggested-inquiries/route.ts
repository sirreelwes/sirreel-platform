import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const LOOKBACK_DAYS = 14;
const PAGE_SIZE = 12;

// Inbound emails that look like inquiries and haven't been considered yet.
// "Considered" = either captured (Inquiry created from this email) or
// dismissed (placeholder Inquiry with status=DISMISSED). Both record the
// email's id under sourceMetadata.emailMessageId.
//
// The response is segmented into two arrays:
//   - newInquiries: emails that look like a fresh thread start (no In-Reply-To
//     header OR the local thread has only one message). These get full visual
//     weight in the UI.
//   - followUps: subsequent messages on existing threads (have In-Reply-To
//     AND the thread already had multiple messages). Grouped by threadId,
//     keeping only the most recent inbound per thread. The UI muting them in
//     a collapsed block so the sales team isn't drowning in client replies
//     that aren't actually new leads.
export async function GET() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  const [emails, considered] = await Promise.all([
    prisma.emailMessage.findMany({
      where: {
        direction: 'inbound',
        category: { in: ['BOOKING_INQUIRY', 'RENTAL_REQUEST'] },
        sentAt: { gte: since },
        // Cross-inbox dedup (Phase E): only the canonical row survives in
        // this query. Older inboxes that picked up the same Message-Id are
        // skipped because their duplicateOfId points at the survivor.
        duplicateOfId: null,
      },
      // Take more than PAGE_SIZE since we'll post-filter (responded threads,
      // dedup by thread). 200 is safe headroom for two 12-row UI sections.
      orderBy: { sentAt: 'desc' },
      take: 200,
      select: {
        id: true,
        threadId: true,
        inReplyTo: true,
        fromAddress: true,
        subject: true,
        snippet: true,
        sentAt: true,
        category: true,
        inferredFormType: true,
        company: { select: { id: true, name: true } },
        person: { select: { id: true, firstName: true, lastName: true, email: true } },
        thread: {
          select: {
            id: true,
            lastDirection: true,
            lastOutboundAt: true,
            messageCount: true,
          },
        },
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

  // Drop emails whose thread has been responded to (lastDirection='OUTBOUND').
  // Threads with no direction state yet (lastDirection=null) are kept — they
  // pre-date the May 2026 backfill or are brand new. Messages without a
  // thread are also kept (defensive — historical edge case).
  const respondedTo = (e: typeof emails[number]) =>
    e.thread?.lastDirection === 'OUTBOUND';

  // First in thread = no In-Reply-To header OR the thread has only one message.
  const isFirstInThread = (e: typeof emails[number]) => {
    const noInReplyTo = !e.inReplyTo || e.inReplyTo.trim() === '';
    const singletonThread = (e.thread?.messageCount ?? 0) <= 1;
    return noInReplyTo || singletonThread;
  };

  // Per-thread dedup: only keep the most recent inbound per thread. emails is
  // already ordered DESC by sentAt, so first-seen-per-thread wins. Messages
  // without a thread bypass dedup (one row per email).
  const seenThreads = new Set<string>();
  const dedupByThread = (e: typeof emails[number]) => {
    if (!e.threadId) return true;
    if (seenThreads.has(e.threadId)) return false;
    seenThreads.add(e.threadId);
    return true;
  };

  const candidates = emails.filter(
    (e) => !respondedTo(e) && !consideredMap.has(e.id) && dedupByThread(e),
  );

  const toRecord = (e: typeof emails[number]) => ({
    emailId: e.id,
    fromAddress: e.fromAddress,
    subject: e.subject,
    snippet: e.snippet,
    sentAt: e.sentAt,
    category: e.category,
    inferredFormType: e.inferredFormType,
    company: e.company,
    person: e.person,
    threadMessageCount: e.thread?.messageCount ?? 1,
  });

  const newInquiries = candidates.filter(isFirstInThread).slice(0, PAGE_SIZE).map(toRecord);
  const followUps = candidates.filter((e) => !isFirstInThread(e)).slice(0, PAGE_SIZE).map(toRecord);

  return NextResponse.json({
    // Legacy field — keeps any existing callers happy. Mirrors newInquiries.
    suggestions: newInquiries,
    newInquiries,
    followUps,
    totalCandidates: emails.length,
    consideredCount: consideredMap.size,
  });
}
