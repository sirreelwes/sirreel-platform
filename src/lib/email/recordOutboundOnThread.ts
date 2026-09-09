/**
 * Record a staff email we sent through Resend as an outbound message on
 * its EmailThread.
 *
 * Mail sent from HQ never touches Gmail, so the ingest pipeline is blind
 * to it: without this, the Job page's "Email threads" section would show
 * the client's half of a conversation and none of ours, the thread would
 * stay INBOUND-last (keeping it in "new inbound" and arming the
 * double-reply guard), and a linked inquiry would never be marked
 * responded.
 *
 * Sibling: recordQuickReplyOnThread in lib/sales/markInquiryResponded,
 * which does the same job for Quick Reply and additionally MINTS a thread
 * from a thread-less inbound. That one keeps its own copy on purpose —
 * importing it here (and this from there) would put a cycle between the
 * two modules for no gain. If you change the thread-state contract below,
 * change it there too; both mirror what the Pub/Sub handler maintains.
 *
 * Best-effort throughout: by the time this runs the email has already
 * left the building, and failing to file a record of it is never a reason
 * to report the send as failed.
 */

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { parseEmailAddress } from '@/lib/email/direction'
import { markInquiriesRespondedForThread } from '@/lib/sales/markInquiryResponded'

export interface RecordOutboundInput {
  /** EmailThread.id the send belongs to. */
  threadId: string
  /** Logged-in agent's address — attribution + the synthetic From:. */
  staffEmail: string
  toAddresses: string[]
  ccAddresses?: string[]
  subject: string
  bodyText: string | null
  bodyHtml: string | null
}

/**
 * EmailMessage.emailAccountId is a required relation, and a send composed
 * in HQ has no inbox behind it. Borrow one, in descending order of
 * "whose conversation is this really":
 *   1. the account the thread's other messages already hang off,
 *   2. the sending agent's own connected mailbox,
 *   3. any active account.
 * Null means email ingestion was never set up — nothing to file against.
 */
async function resolveEmailAccountId(threadId: string, staffEmail: string): Promise<string | null> {
  const onThread = await prisma.emailMessage.findFirst({
    where: { threadId },
    orderBy: { sentAt: 'desc' },
    select: { emailAccountId: true },
  })
  if (onThread?.emailAccountId) return onThread.emailAccountId

  const agent = await prisma.emailAccount.findUnique({
    where: { emailAddress: parseEmailAddress(staffEmail) },
    select: { id: true },
  })
  if (agent) return agent.id

  const any = await prisma.emailAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return any?.id ?? null
}

export async function recordOutboundOnThread(
  input: RecordOutboundInput,
): Promise<{ emailMessageId: string; respondedInquiryIds: string[] } | null> {
  try {
    const now = new Date()
    const emailAccountId = await resolveEmailAccountId(input.threadId, input.staffEmail)
    if (!emailAccountId) return null

    const cc = (input.ccAddresses ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean)

    const created = await prisma.emailMessage.create({
      data: {
        emailAccountId,
        threadId: input.threadId,
        // Synthetic id — there is no Gmail message. Prefixed so the row is
        // recognizable and can never collide with a real Gmail id.
        gmailMessageId: `hq-reply-${randomUUID()}`,
        fromAddress: parseEmailAddress(input.staffEmail),
        toAddresses: input.toAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean),
        subject: input.subject,
        snippet: (input.bodyText || '').slice(0, 200) || null,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        bodySource: input.bodyText ? 'plain' : 'html-converted',
        direction: 'outbound',
        // The CC is stored where every other CC on this thread lives, so
        // the NEXT reply's participant read (lib/email/threadParticipants)
        // sees the people this send added — not just the ones the client
        // originally looped in.
        routingHeaders: cc.length > 0 ? { cc: cc.join(', ') } : undefined,
        sentAt: now,
        isRead: true,
        status: 'TRIAGED',
        triageAt: now,
      },
      select: { id: true },
    })

    // Same thread-state contract the Pub/Sub handler maintains. This send
    // is "now" and so is the latest message by construction — a plain set
    // is safe.
    const thread = await prisma.emailThread.update({
      where: { id: input.threadId },
      data: {
        lastMessageAt: now,
        messageCount: { increment: 1 },
        lastOutboundAt: now,
        lastDirection: 'OUTBOUND',
      },
      select: { id: true, gmailThreadId: true },
    })

    const respondedInquiryIds = await markInquiriesRespondedForThread({
      threadKeys: [thread.id, thread.gmailThreadId],
      staffEmail: input.staffEmail,
      at: now,
    })
    return { emailMessageId: created.id, respondedInquiryIds }
  } catch (err) {
    console.warn(
      '[recordOutboundOnThread] failed (non-blocking):',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * Start a thread for a conversation HQ opened itself (no client email to
 * reply to). Filed in the Job immediately, so the send shows up in the
 * Job's "Email threads" section like any other.
 *
 * Honest limitation: the client's REPLY arrives in the agent's Gmail with
 * a Gmail thread id that has nothing to do with the synthetic one below,
 * so it lands as its own thread rather than joining this one. It still
 * reaches a human and still flows into HQ — sendAgreementEmail's Reply-To
 * handling sees to that — it just needs filing to the Job by hand. This
 * is the same seam Quick Reply has always had; replying INTO an existing
 * thread (the common case from the Job page) has no such gap.
 */
export async function startThreadForJob(input: {
  jobId: string
  subject: string
}): Promise<string | null> {
  try {
    const now = new Date()
    const thread = await prisma.emailThread.create({
      data: {
        gmailThreadId: `hq-job-${randomUUID()}`,
        subject: input.subject,
        lastMessageAt: now,
        messageCount: 0,
        jobId: input.jobId,
      },
      select: { id: true },
    })
    return thread.id
  } catch (err) {
    console.warn(
      '[startThreadForJob] failed (non-blocking):',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
