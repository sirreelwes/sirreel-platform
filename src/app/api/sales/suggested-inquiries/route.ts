import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import {
  classifyInquiryForPipeline,
  type InquiryClassification,
} from '@/lib/email/classifyInquiryForPipeline';

export const dynamic = 'force-dynamic';

const LOOKBACK_DAYS = 14;
const PAGE_SIZE = 12;
const HIDDEN_LIST_LIMIT = 60;
// Raised 8 → 12 when the any-outbound rule moved every active chain into
// this stream — at 8 the cap was already full and silently truncating.
const RESPONDED_LIMIT = 12;

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
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
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
        // Cross-inbox collapse key — set by the sending server, identical
        // on every inbox's copy.
        rfc822MessageId: true,
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
        // Cross-inbox sibling threads. Gmail thread ids are PER MAILBOX,
        // so when the same message lands in four watched inboxes, each
        // inbox grows its own EmailThread — and a staff reply only lands
        // on the threads of the inboxes it was addressed/CC'd to. The
        // canonical copy (duplicateOfId: null, the one this query keeps)
        // can therefore sit on a thread that never saw the reply: Jose
        // answered Orlando's Steel Deck email on jose@'s thread while
        // info@'s canonical copy stayed 1-message/no-outbound, so HQ
        // showed the lead as untouched (Wes 2026-08-28). Judge responded
        // state across the canonical thread AND every duplicate's thread.
        duplicates: {
          select: {
            thread: {
              select: {
                id: true,
                lastDirection: true,
                lastOutboundAt: true,
                messageCount: true,
              },
            },
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

  // Drop emails whose thread has been responded to — ANY staff outbound on
  // the thread counts (lastOutboundAt set), not just outbound-last. The old
  // lastDirection==='OUTBOUND' test flipped a thread back to full "new
  // inbound" weight the moment the client replied to our reply, so active
  // 10-message conversations sat in the untriaged queue looking untouched
  // (Wes 2026-08-28: "someone has responded and there is an email chain
  // already — not accurate to leave them in new inbound"). Threads with no
  // outbound at all are kept pending even when the client has sent several
  // messages — those are genuinely unanswered. Messages without a thread
  // are also kept (defensive — historical edge case).
  //
  // Sibling threads (see the `duplicates` select above): the conversation's
  // true state is the union of every inbox's thread, so all of these read
  // across canonical + duplicates.
  type EmailRow = typeof emails[number]
  type ThreadState = NonNullable<EmailRow['thread']>
  const threadsOf = (e: EmailRow): ThreadState[] =>
    [e.thread, ...e.duplicates.map((d) => d.thread)].filter((t): t is ThreadState => !!t);
  // The most-informed sibling — the inbox that saw the deepest slice of the
  // conversation. Drives the msgs count and the client-replied-since flag.
  const bestThread = (e: EmailRow): ThreadState | null =>
    threadsOf(e).reduce<ThreadState | null>(
      (best, t) => (!best || t.messageCount > best.messageCount ? t : best),
      null,
    );
  // Thread-based reply detection. Necessary but NOT sufficient — see
  // repliedByParticipant below.
  const respondedOnThread = (e: EmailRow) =>
    threadsOf(e).some((t) => t.lastDirection === 'OUTBOUND' || !!t.lastOutboundAt);

  // First in thread = no In-Reply-To header OR the thread has only one message.
  const isFirstInThread = (e: EmailRow) => {
    const noInReplyTo = !e.inReplyTo || e.inReplyTo.trim() === '';
    const singletonThread = (bestThread(e)?.messageCount ?? 0) <= 1;
    return noInReplyTo || singletonThread;
  };

  // Per-thread dedup: only keep the most recent inbound per thread. emails is
  // already ordered DESC by sentAt, so first-seen-per-thread wins. Messages
  // without a thread bypass dedup (one row per email).
  // ── Did we actually write back to this person? ────────────────────
  //
  // Thread state alone gets this wrong, and often. Gmail thread ids are
  // per-mailbox, a reply sent from HQ through Resend lands on a thread of
  // its own, and cross-inbox dedup does not always link the copies — so
  // an answered lead can sit on a thread that has never seen an outbound.
  //
  // Measured 2026-08-29: of 14 leads the thread logic called unanswered,
  // EIGHT had been replied to — Wes's own reply to alfonso@ among them.
  // A queue that is 57% already-handled is one people stop trusting, and
  // then stop working.
  //
  // So: ask the question the rep is actually asking. Has anything gone
  // OUT to this address since their message came IN? One extra query,
  // and it does not care how the threading landed.
  const senderAddress = (e: EmailRow) =>
    (e.fromAddress.match(/<([^>]+)>/)?.[1] ?? e.fromAddress).toLowerCase().trim();

  const candidateAddresses = [...new Set(emails.map(senderAddress))].filter(Boolean);
  const outboundToCandidates = candidateAddresses.length
    ? await prisma.emailMessage.findMany({
        where: {
          direction: 'outbound',
          sentAt: { gte: since },
          toAddresses: { hasSome: candidateAddresses },
        },
        select: { toAddresses: true, sentAt: true },
      })
    : [];
  const latestReplyTo = new Map<string, Date>();
  for (const o of outboundToCandidates) {
    for (const raw of o.toAddresses) {
      const addr = raw.toLowerCase().trim();
      const cur = latestReplyTo.get(addr);
      if (!cur || o.sentAt > cur) latestReplyTo.set(addr, o.sentAt);
    }
  }
  const repliedByParticipant = (e: EmailRow) => {
    const when = latestReplyTo.get(senderAddress(e));
    return !!when && when > e.sentAt;
  };

  const respondedTo = (e: EmailRow) => respondedOnThread(e) || repliedByParticipant(e);

  // Dedup by MESSAGE, then by thread.
  //
  // The same email lands in several watched inboxes and should collapse
  // to one card via duplicateOfId — but that linkage is not always
  // written (alfonso@ arrived as three separate canonical rows sharing
  // one rfc822MessageId, and showed up twice in the queue). The RFC-822
  // Message-ID is set by the sending server and is identical across every
  // copy, so it is the reliable collapse key.
  const seenMessageIds = new Set<string>();
  const dedupByMessageId = (e: EmailRow) => {
    if (!e.rfc822MessageId) return true;
    if (seenMessageIds.has(e.rfc822MessageId)) return false;
    seenMessageIds.add(e.rfc822MessageId);
    return true;
  };

  const seenThreads = new Set<string>();
  const dedupByThread = (e: EmailRow) => {
    if (!e.threadId) return true;
    if (seenThreads.has(e.threadId)) return false;
    seenThreads.add(e.threadId);
    return true;
  };

  const candidates = emails.filter(
    (e) => !respondedTo(e) && !consideredMap.has(e.id) && dedupByMessageId(e) && dedupByThread(e),
  );

  // Responded stream — same considered/dedup discipline, opposite
  // direction test. Separate seen-set: a thread is either OUTBOUND-last
  // or not, so the two streams can't overlap.
  const seenRespondedThreads = new Set<string>();
  const seenRespondedMessageIds = new Set<string>();
  const respondedCandidates = emails.filter((e) => {
    if (!respondedTo(e) || consideredMap.has(e.id)) return false;
    // Same message-level collapse as the pending stream, or one answered
    // lead renders once per inbox that received it.
    if (e.rfc822MessageId) {
      if (seenRespondedMessageIds.has(e.rfc822MessageId)) return false;
      seenRespondedMessageIds.add(e.rfc822MessageId);
    }
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
  // All sibling thread ids — the outbound that answered this lead may live
  // on any inbox's copy of the conversation, not the canonical one.
  const respondedThreadIds = respondedIncluded
    .flatMap((c) => threadsOf(c.email).map((t) => t.id))
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

  const toRecord = (e: EmailRow) => ({
    emailId: e.id,
    fromAddress: e.fromAddress,
    subject: e.subject,
    snippet: e.snippet,
    sentAt: e.sentAt,
    category: e.category,
    inferredFormType: e.inferredFormType,
    company: e.company,
    person: e.person,
    threadMessageCount: bestThread(e)?.messageCount ?? 1,
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
      // Latest outbound across every sibling thread of this conversation.
      const latest = threadsOf(c.email)
        .map((t) => latestOutboundByThread.get(t.id))
        .filter((v): v is { fromAddress: string; sentAt: Date } => !!v)
        .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
      const best = bestThread(c.email);
      return {
        ...toRecord(c.email),
        repliedBy: latest?.fromAddress ?? null,
        repliedAt: latest?.sentAt ?? best?.lastOutboundAt ?? null,
        // With any-outbound threads now living here, INBOUND-last means
        // the client wrote back after our reply — the conversation has
        // the client holding the last word. The card flags it so moving
        // these out of "new inbound" doesn't hide the follow-up need.
        // Judged on the deepest sibling thread — the inbox that saw the
        // most of the conversation.
        clientRepliedSince: best?.lastDirection === 'INBOUND',
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
