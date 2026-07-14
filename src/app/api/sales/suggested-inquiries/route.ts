import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  classifyInquiryForPipeline,
  type InquiryClassification,
} from '@/lib/email/classifyInquiryForPipeline';

export const dynamic = 'force-dynamic';

const LOOKBACK_DAYS = 14;
const PAGE_SIZE = 12;
const HIDDEN_LIST_LIMIT = 60;
const RESPONDED_LIMIT = 8;

// Inbound emails that look like inquiries and haven't been considered yet.
// "Considered" = either captured (Inquiry created from this email) or
// dismissed (placeholder Inquiry with status=DISMISSED). Both record the
// email's id under sourceMetadata.emailMessageId.
//
// The response is segmented into:
//   - newInquiries: emails that look like a fresh thread start (no In-Reply-To
//     header OR the local thread has only one message). These get full visual
//     weight in the UI.
//   - followUps: subsequent messages on existing threads (have In-Reply-To
//     AND the thread already had multiple messages). Grouped by threadId,
//     keeping only the most recent inbound per thread. The UI mutes them in
//     a collapsed block so the sales team isn't drowning in client replies
//     that aren't actually new leads.
//   - hidden: candidates excluded by classifyInquiryForPipeline (Cognito
//     paperwork, damage reports, COIs, AI-detected rejections/confirmations).
//     Surfaced in a count + expandable panel so reps can spot false negatives.
//   - responded: inquiry-looking emails whose thread is OUTBOUND-last (a
//     Quick Reply or a Gmail-synced staff reply already went out). These
//     used to vanish from the list entirely; now they're returned with
//     repliedBy/repliedAt (latest outbound on the thread) so the card can
//     stay visible with a "Replied by … ·  when" marker instead of looking
//     like it was never handled.
export async function GET() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  const [emails, considered] = await Promise.all([
    prisma.emailMessage.findMany({
      where: {
        direction: 'inbound',
        sentAt: { gte: since },
        // Inquiry gate — trust the AI extractor's messageNature output
        // (validated May 20: 9/9 'inquiry'-tagged rows in the labeling
        // sample were genuine fresh leads, zero noise). Replaces the
        // sync-time category=BOOKING_INQUIRY filter that was promoting
        // newsletters / RW notifications / Cognito paperwork into the
        // candidate pool via an over-broad keyword regex.
        extractedData: { path: ['messageNature'], equals: 'inquiry' },
        // Belt: extractionConfidence === 0 is the FALLBACK shape (AI
        // call failed or never ran). Require any positive confidence
        // so a key-missing outage doesn't silently empty the pipeline
        // OR (worse) leak FALLBACK rows in if their messageNature was
        // ever erroneously persisted as 'inquiry'.
        extractionConfidence: { gt: 0 },
        // Cross-inbox dedup (Phase E): only the canonical row survives in
        // this query. Older inboxes that picked up the same Message-Id are
        // skipped because their duplicateOfId points at the survivor.
        duplicateOfId: null,
      },
      // Take more than PAGE_SIZE since we'll post-filter (responded threads,
      // dedup by thread, content-based classification). 200 is safe headroom
      // for two 12-row UI sections plus a hidden-items panel.
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
        extractedData: true,
        extractionConfidence: true,
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

  // Responded stream — same considered/dedup discipline, opposite
  // direction test. Separate seen-set: a thread is either OUTBOUND-last
  // or not, so the two streams can't overlap.
  const seenRespondedThreads = new Set<string>();
  const respondedCandidates = emails.filter((e) => {
    if (!respondedTo(e) || consideredMap.has(e.id)) return false;
    if (e.threadId) {
      if (seenRespondedThreads.has(e.threadId)) return false;
      seenRespondedThreads.add(e.threadId);
    }
    return true;
  });

  // Classify each candidate. AI extraction is the primary signal when
  // available; subject-prefix fallback otherwise. Paperwork / damage /
  // COI fall into `hidden` so the sales section shows only real leads.
  const classified = candidates.map((e) => ({
    email: e,
    result: classifyInquiryForPipeline({
      subject: e.subject,
      inReplyTo: e.inReplyTo,
      extractedData: e.extractedData,
      extractionConfidence: e.extractionConfidence,
    }),
  }));

  const included = classified.filter((c) => c.result.include);
  const hiddenAll = classified.filter((c) => !c.result.include);

  // Responded: classify with the same gate (only real leads), then pull
  // the latest outbound per thread for the "Replied by … · when" marker.
  const respondedIncluded = respondedCandidates
    .map((e) => ({
      email: e,
      result: classifyInquiryForPipeline({
        subject: e.subject,
        inReplyTo: e.inReplyTo,
        extractedData: e.extractedData,
        extractionConfidence: e.extractionConfidence,
      }),
    }))
    .filter((c) => c.result.include)
    .slice(0, RESPONDED_LIMIT);
  const respondedThreadIds = respondedIncluded
    .map((c) => c.email.threadId)
    .filter((v): v is string => !!v);
  const latestOutboundByThread = new Map<string, { fromAddress: string; sentAt: Date }>();
  if (respondedThreadIds.length > 0) {
    const outs = await prisma.emailMessage.findMany({
      where: { threadId: { in: respondedThreadIds }, direction: 'outbound' },
      orderBy: { sentAt: 'desc' },
      select: { threadId: true, fromAddress: true, sentAt: true },
    });
    for (const o of outs) {
      if (o.threadId && !latestOutboundByThread.has(o.threadId)) {
        latestOutboundByThread.set(o.threadId, { fromAddress: o.fromAddress, sentAt: o.sentAt });
      }
    }
  }

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

  const newInquiries = included.filter((c) => isFirstInThread(c.email)).slice(0, PAGE_SIZE).map((c) => toRecord(c.email));
  const followUps = included.filter((c) => !isFirstInThread(c.email)).slice(0, PAGE_SIZE).map((c) => toRecord(c.email));

  const hiddenCounts: Record<InquiryClassification, number> = {
    inquiry: 0,
    paperwork: 0,
    damage_report: 0,
    coi: 0,
    rejection: 0,
    confirmation: 0,
    other: 0,
  };
  for (const c of hiddenAll) hiddenCounts[c.result.classification] += 1;

  const hiddenItems = hiddenAll.slice(0, HIDDEN_LIST_LIMIT).map((c) => ({
    emailId: c.email.id,
    fromAddress: c.email.fromAddress,
    subject: c.email.subject,
    sentAt: c.email.sentAt,
    classification: c.result.classification,
    reason: c.result.reason,
  }));

  return NextResponse.json({
    // Legacy field — keeps any existing callers happy. Mirrors newInquiries.
    suggestions: newInquiries,
    newInquiries,
    followUps,
    responded: respondedIncluded.map((c) => {
      const latest = c.email.threadId ? latestOutboundByThread.get(c.email.threadId) : undefined;
      return {
        ...toRecord(c.email),
        repliedBy: latest?.fromAddress ?? null,
        repliedAt: latest?.sentAt ?? c.email.thread?.lastOutboundAt ?? null,
      };
    }),
    hidden: {
      counts: hiddenCounts,
      items: hiddenItems,
      totalHidden: hiddenAll.length,
    },
    totalCandidates: emails.length,
    consideredCount: consideredMap.size,
  });
}
