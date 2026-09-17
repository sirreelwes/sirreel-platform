/**
 * One thread per job — the send wrapper and the ingest resolver.
 *
 * `sendOnJobThread()` is what every client-facing send on a job goes
 * through (quote, welcome, paperwork summary, follow-up, portal invite,
 * invoice, the job composer). It puts the three anchors on the email
 * (see jobThreadRules.ts), sends through `sendAgreementEmail` exactly as
 * before, and records the send — WITH its Message-ID — on the job's root
 * thread so the next send can reply to it and a client's reply can prove
 * where it belongs.
 *
 * `resolveJobForIngest()` is the other half: given an inbound message's
 * headers, which job is it on? Job address first (anchor B), then the
 * References chain against stored ids (anchor A). The pubsub route files
 * the thread to that job — fill-only, never re-pointing a thread a person
 * filed elsewhere.
 *
 * Best-effort throughout on the RECORD side: the anchors are computed
 * before the send and a failure there falls back to the plain send the
 * route always made (the client still gets the email; the thread splits
 * the way it did before this shipped). A failure AFTER the send is
 * logged and never turns a sent email into a reported failure.
 */

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail, SEND_FROM, type EmailPayload, type EmailResult } from '@/lib/email/sendAgreementEmail'
import { recordOutboundOnThread } from '@/lib/email/recordOutboundOnThread'
import { parseEmailAddress } from '@/lib/email/direction'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import {
  jobRootThreadKey,
  mintJobMessageId,
  parseMessageIds,
  rootSubjectFor,
  threadSendSubject,
  threadingHeaders,
  withJobAddress,
  withoutJobAddress,
} from '@/lib/email/jobThreadRules'

export interface JobThreadContext {
  jobId: string
  jobCode: string
  /** EmailThread.id of the job's root thread (created on first use). */
  threadId: string
  /** The stable subject every send on this job carries (no Re:). */
  rootSubject: string
  /** True when nothing has been filed to the job yet — no Re:, no chain. */
  isFirst: boolean
  rootMessageId: string | null
  lastMessageId: string | null
}

/**
 * Everything already filed to the job, oldest and newest ids — across
 * EVERY thread with this jobId, not just the root: the client's original
 * inquiry (filed by hand or by conversion) is the best thing for our
 * first send to be a reply to.
 */
async function chainForJob(jobId: string): Promise<{
  count: number
  rootMessageId: string | null
  lastMessageId: string | null
  newestFiledSubject: string | null
}> {
  const where = { thread: { is: { jobId } }, rfc822MessageId: { not: null } }
  const [count, oldest, newest, newestThread] = await Promise.all([
    prisma.emailMessage.count({ where: { thread: { is: { jobId } } } }),
    prisma.emailMessage.findFirst({ where, orderBy: { sentAt: 'asc' }, select: { rfc822MessageId: true } }),
    prisma.emailMessage.findFirst({ where, orderBy: { sentAt: 'desc' }, select: { rfc822MessageId: true } }),
    prisma.emailThread.findFirst({
      where: { jobId, messageCount: { gt: 0 } },
      orderBy: { lastMessageAt: 'desc' },
      select: { subject: true },
    }),
  ])
  return {
    count,
    rootMessageId: oldest?.rfc822MessageId ?? null,
    lastMessageId: newest?.rfc822MessageId ?? null,
    newestFiledSubject: newestThread?.subject ?? null,
  }
}

async function loadJob(jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, jobCode: true, name: true, company: { select: { name: true } } },
  })
}

/**
 * The job's root thread + the chain to reply into. Creates the root
 * thread on first use (deterministic key, so two sends racing cannot
 * mint two roots — the unique index makes the loser re-read).
 */
export async function jobThreadContext(jobId: string): Promise<JobThreadContext | null> {
  const job = await loadJob(jobId)
  if (!job) return null
  const key = jobRootThreadKey(job.id)
  const chain = await chainForJob(job.id)

  let root = await prisma.emailThread.findUnique({ where: { gmailThreadId: key }, select: { id: true, subject: true } })
  if (!root) {
    const subject = rootSubjectFor({
      jobName: resolveDisplayJobName({ jobName: job.name, companyName: job.company?.name ?? null }),
      jobCode: job.jobCode,
      filedSubject: chain.newestFiledSubject,
    })
    try {
      root = await prisma.emailThread.create({
        data: { gmailThreadId: key, subject, lastMessageAt: new Date(), messageCount: 0, jobId: job.id },
        select: { id: true, subject: true },
      })
    } catch {
      // Lost a race with another send — the row exists now.
      root = await prisma.emailThread.findUnique({ where: { gmailThreadId: key }, select: { id: true, subject: true } })
      if (!root) return null
    }
  }

  return {
    jobId: job.id,
    jobCode: job.jobCode,
    threadId: root.id,
    rootSubject: root.subject,
    isFirst: chain.count === 0,
    rootMessageId: chain.rootMessageId,
    lastMessageId: chain.lastMessageId,
  }
}

/**
 * READ-ONLY twin of jobThreadContext for the preview endpoints: the
 * subject the send WILL use, computed without creating the root thread
 * (a preview sends nothing and writes nothing). Null when the job is
 * unknown — the caller keeps its template subject.
 */
export async function previewJobThreadSubject(jobId: string): Promise<string | null> {
  try {
    const job = await loadJob(jobId)
    if (!job) return null
    const chain = await chainForJob(job.id)
    const root = await prisma.emailThread.findUnique({
      where: { gmailThreadId: jobRootThreadKey(job.id) },
      select: { subject: true },
    })
    const rootSubject =
      root?.subject ??
      rootSubjectFor({
        jobName: resolveDisplayJobName({ jobName: job.name, companyName: job.company?.name ?? null }),
        jobCode: job.jobCode,
        filedSubject: chain.newestFiledSubject,
      })
    return threadSendSubject(rootSubject, chain.count === 0)
  } catch (err) {
    console.warn('[jobThread] preview subject failed (non-blocking):', err instanceof Error ? err.message : err)
    return null
  }
}

export type SendOnJobThreadInput = EmailPayload & {
  /** Null/undefined = no job known → the plain send the route always made. */
  jobId: string | null | undefined
  /**
   * Who is writing — the signed-in agent for a human send, omitted for a
   * system send (recorded as the notifications@ sender). Attribution only.
   */
  staffEmail?: string | null
  /**
   * Opt OUT of the thread: a fresh Message-ID, the caller's own subject,
   * no job address. For the rare send that must stand alone. Default off.
   */
  separate?: boolean
}

export type SendOnJobThreadResult = EmailResult & {
  /** The subject that actually went out (the thread's, unless `separate`). */
  subject: string
  /** Root thread the send was recorded on; null when not recorded. */
  threadId: string | null
  /** The minted Message-ID; null on a separate or fallback send. */
  messageId: string | null
}

/**
 * Send a client-facing email ON the job's thread. Drop-in for
 * `sendAgreementEmail` at any call site that knows its job: same payload
 * plus `jobId`. The subject the caller passes is kept only for a
 * `separate` send or when the thread context cannot be built.
 */
export async function sendOnJobThread(input: SendOnJobThreadInput): Promise<SendOnJobThreadResult> {
  const { jobId, staffEmail, separate, ...payload } = input

  let ctx: JobThreadContext | null = null
  if (!separate && jobId) {
    try {
      ctx = await jobThreadContext(jobId)
    } catch (err) {
      console.warn('[jobThread] context failed — sending off-thread:', err instanceof Error ? err.message : err)
    }
  }
  if (!ctx) {
    const plain = await sendAgreementEmail(payload)
    return { ...plain, subject: payload.subject, threadId: null, messageId: null }
  }

  const messageId = mintJobMessageId(ctx.jobCode, randomUUID())
  const subject = threadSendSubject(ctx.rootSubject, ctx.isFirst)
  const cc = withJobAddress(payload.cc, payload.to, ctx.jobCode)
  const headers = {
    ...(payload.headers ?? {}),
    ...threadingHeaders({ messageId, rootMessageId: ctx.rootMessageId, lastMessageId: ctx.lastMessageId }),
  }

  // The hello@ REPLY-TO CAPTURE is not needed on a thread send, so it is
  // turned off here (Wes 2026-09-17: "I don't understand why there are
  // emails still getting generated from the system that go there").
  //
  // `effectiveReplyTo` appends hello@ whenever the Reply-To is an on-domain
  // address the ingest does not fully watch — wes@, hq@ — because a reply to
  // a Resend send used to carry an In-Reply-To HQ had never stored, leaving
  // no way to prove the reply belonged to an HQ conversation. The hello@
  // copy was that proof (Wes's ruling 2026-08-28).
  //
  // Phase 1 removed the premise. Every send from here carries an HQ-MINTED
  // Message-ID that is stored on the outbound row, plus `jobs+<code>@` on
  // Cc — two independent anchors, either of which files the reply. Keeping
  // hello@ as well only shows the client a second reply address, one of them
  // a shared inbox, and fills that mailbox with copies of conversations
  // already filed. Sends with NO job still get the capture: they have no
  // anchor, which is exactly the case the trick was built for.
  const exactReplyTo = { replyToExact: true as const }
  let result = await sendAgreementEmail({ ...payload, ...exactReplyTo, subject, cc, headers })
  if (!result.ok && /message.?id|header/i.test(result.reason)) {
    // Resend's docs do not say whether a caller-set Message-ID is honoured
    // or refused. A refusal must not cost the client their quote: send
    // again without it. The marker header and the chain still go, and the
    // own-copy that lands in jobs@ teaches the ingest the id Resend used.
    console.warn('[jobThread] send refused with Message-ID set — retrying without it:', result.reason)
    const { 'Message-ID': _dropped, ...rest } = headers
    void _dropped
    result = await sendAgreementEmail({ ...payload, ...exactReplyTo, subject, cc, headers: rest })
  }
  if (!result.ok) return { ...result, subject, threadId: ctx.threadId, messageId }

  // The record is what makes the NEXT send a reply and the client's reply
  // provable. Best-effort: the mail has left.
  const recorded = await recordOutboundOnThread({
    threadId: ctx.threadId,
    staffEmail: staffEmail || parseEmailAddress(payload.from || SEND_FROM),
    toAddresses: payload.to,
    ccAddresses: withoutJobAddress(cc),
    subject,
    bodyText: payload.text ?? null,
    bodyHtml: payload.html ?? null,
    rfc822MessageId: messageId,
    inReplyTo: headers['In-Reply-To'] ?? null,
    label: payload.label ?? null,
  })

  return { ...result, subject, threadId: recorded ? ctx.threadId : null, messageId }
}

/**
 * Which job does an ingested message belong to? Anchor B (the job
 * address in any recipient header) wins; otherwise anchor A — any id in
 * its Message-ID / In-Reply-To / References chain that names a stored
 * message on a thread filed to a job (through a cross-inbox duplicate's
 * canonical row too, so HQ's own jobs@ copy counts). Null = no proof;
 * the thread stays unfiled for a person to place, as before.
 */
export async function resolveJobForIngest(args: {
  jobCode: string | null
  rfc822MessageId?: string | null
  inReplyTo?: string | null
  references?: string | null
  /** The X-SirReel-Job-Message header, when the message carries one. */
  jobMessageId?: string | null
}): Promise<string | null> {
  try {
    if (args.jobCode) {
      const job = await prisma.job.findUnique({ where: { jobCode: args.jobCode }, select: { id: true } })
      if (job) return job.id
    }
    const ids = Array.from(
      new Set([
        ...(args.jobMessageId ? [args.jobMessageId] : []),
        ...(args.rfc822MessageId ? [args.rfc822MessageId] : []),
        ...parseMessageIds(args.inReplyTo),
        ...parseMessageIds(args.references),
      ]),
    )
    if (ids.length === 0) return null
    const hits = await prisma.emailMessage.findMany({
      where: { rfc822MessageId: { in: ids } },
      select: {
        thread: { select: { jobId: true } },
        duplicateOf: { select: { thread: { select: { jobId: true } } } },
      },
      take: 20,
    })
    for (const h of hits) {
      const jobId = h.thread?.jobId ?? h.duplicateOf?.thread?.jobId ?? null
      if (jobId) return jobId
    }
    return null
  } catch (err) {
    console.warn('[jobThread] resolveJobForIngest failed (non-blocking):', err instanceof Error ? err.message : err)
    return null
  }
}
