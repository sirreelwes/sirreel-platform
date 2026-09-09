import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { sendAgreementEmail, SEND_FROM } from '@/lib/email/sendAgreementEmail'
import { splitCcInput } from '@/lib/email/ccList'
import { agentReplyTo } from '@/lib/email/teamVisibility'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { participantsForReply } from '@/lib/email/threadParticipants'
import { buildJobMessageEmail } from '@/lib/email/templates/jobMessage'
import { recordOutboundOnThread, startThreadForJob } from '@/lib/email/recordOutboundOnThread'
import { fileThreadInJobIfUnfiled } from '@/lib/jobs/attachThreadToJob'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'

export const dynamic = 'force-dynamic'

/**
 * Email the client from the Job page.
 *
 * Wes 2026-09-09: "I need a button to email client from Job Detail Page.
 * I hate having to go back to email in order to send. We should be able to
 * populate an email from here that cc's whomever was on the thread's
 * latest email."
 *
 *   GET  — compose the draft: who it goes to, who gets CC'd (read off the
 *          chosen thread's latest message), the subject. Sends nothing.
 *   POST — send it, then file the send on the thread so the Job page's
 *          "Email threads" section shows our half of the conversation.
 *
 * The POST takes the agent's PLAIN TEXT and renders the HTML itself. It
 * never accepts a body from the browser: HTML off the wire is a
 * mail-injection hole, and what the client receives should be produced by
 * the same code that produced the preview.
 */

/**
 * CC ceiling for this composer. Deliberately NOT lib/email/ccList's
 * MAX_CC of 5 — that guards a box a rep types into by hand, where six
 * entries means a typo. Here the list is READ OFF a real conversation,
 * and silently trimming it to five would drop exactly the person Wes
 * asked to keep on: the coordinator the client looped in. Still bounded,
 * because an unbounded recipient list is how a thread turns into a
 * mailing list.
 */
const MAX_JOB_EMAIL_CC = 15

async function actor(): Promise<{ email: string; name: string | null; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { email: true, name: true, role: true },
  })
  return user ?? null
}

/** Subject for a reply — Gmail's rule: prefix once, never stack. */
function replySubject(threadSubject: string): string {
  const s = (threadSubject || '').trim()
  if (!s) return 'Re:'
  return /^re:/i.test(s) ? s : `Re: ${s}`
}

async function loadJob(jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobCode: true,
      name: true,
      company: { select: { id: true, name: true } },
      jobContacts: {
        select: {
          id: true,
          role: true,
          isPrimary: true,
          person: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }],
      },
    },
  })
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await actor()
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const job = await loadJob(params.id)
  if (!job) return NextResponse.json({ ok: false, error: 'job not found' }, { status: 404 })

  const threads = await prisma.emailThread.findMany({
    where: { jobId: job.id },
    orderBy: { lastMessageAt: 'desc' },
    take: 20,
    select: {
      id: true,
      subject: true,
      lastMessageAt: true,
      messageCount: true,
      messages: {
        orderBy: { sentAt: 'desc' },
        // Only the tail matters: the CC list comes off the latest message
        // and the To: off the latest INBOUND one, both near the end.
        take: 25,
        select: {
          id: true,
          fromAddress: true,
          toAddresses: true,
          direction: true,
          sentAt: true,
          routingHeaders: true,
        },
      },
    },
  })

  // Which conversation are we answering? An explicit ?threadId wins (the
  // Reply button on a specific thread card); otherwise the most recently
  // touched one, which is what "reply to the client" means on a job with
  // a single conversation — the overwhelmingly common case.
  const wanted = req.nextUrl.searchParams.get('threadId')
  const thread =
    (wanted ? threads.find((t) => t.id === wanted) : null) ?? threads[0] ?? null

  const participants = thread
    ? participantsForReply(thread.messages)
    : { to: null, cc: [], internal: [], sourceMessageId: null, sourceSentAt: null }

  const primary = pickPrimaryContact(job.jobContacts)
  const contacts = job.jobContacts
    .filter((c) => !!c.person.email)
    .map((c) => ({
      id: c.id,
      name: `${c.person.firstName ?? ''} ${c.person.lastName ?? ''}`.trim() || c.person.email!,
      email: c.person.email!.toLowerCase(),
      role: c.role as string,
      isPrimary: c.isPrimary,
    }))

  // Thread first, job contacts as the fallback: on a thread the client is
  // already writing from an address they actually read, which beats
  // whatever we typed into the contact record months ago.
  const to = participants.to ?? primary?.person.email?.toLowerCase() ?? null

  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      jobCode: job.jobCode,
      name: resolveDisplayJobName({ jobName: job.name, companyName: job.company?.name ?? null }),
      company: job.company?.name ?? null,
    },
    from: SEND_FROM,
    replyTo: agentReplyTo(me.email),
    to,
    cc: participants.cc.slice(0, MAX_JOB_EMAIL_CC),
    /** Our own people who were on the thread. Shown, never CC'd — the
     *  team's copy is the sales-desk channel's job. */
    internalOnThread: participants.internal,
    teamCc: await channelRecipients('sales-team-cc'),
    subject: thread ? replySubject(thread.subject) : job.name,
    contacts,
    thread: thread
      ? {
          id: thread.id,
          subject: thread.subject,
          messageCount: thread.messageCount,
          lastMessageAt: thread.lastMessageAt.toISOString(),
          participantsAsOf: participants.sourceSentAt,
        }
      : null,
    threads: threads.map((t) => ({
      id: t.id,
      subject: t.subject,
      lastMessageAt: t.lastMessageAt.toISOString(),
      messageCount: t.messageCount,
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await actor()
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!can(me.role as Parameters<typeof can>[0], 'canCreateBooking')) {
    return NextResponse.json(
      { ok: false, error: 'sending client mail is a sales action' },
      { status: 403 },
    )
  }

  const job = await loadJob(params.id)
  if (!job) return NextResponse.json({ ok: false, error: 'job not found' }, { status: 404 })

  const payload = (await req.json().catch(() => ({}))) as {
    threadId?: string | null
    to?: unknown
    cc?: unknown
    subject?: unknown
    body?: unknown
  }

  // Re-parsed server-side. The browser's validation is a convenience, not
  // a control — the request can say anything.
  const toParsed = splitCcInput(payload.to)
  const to = toParsed.valid[0] ?? null
  if (!to) {
    return NextResponse.json(
      { ok: false, error: toParsed.invalid.length ? `Not an email address: ${toParsed.invalid[0]}` : 'A recipient is required.' },
      { status: 400 },
    )
  }
  const ccParsed = splitCcInput(payload.cc)
  const cc = ccParsed.valid.filter((a) => a !== to).slice(0, MAX_JOB_EMAIL_CC)

  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : ''
  const bodyText = typeof payload.body === 'string' ? payload.body.trim() : ''
  if (!subject) return NextResponse.json({ ok: false, error: 'A subject is required.' }, { status: 400 })
  if (!bodyText) return NextResponse.json({ ok: false, error: 'The message is empty.' }, { status: 400 })

  const jobName = resolveDisplayJobName({
    jobName: job.name,
    companyName: job.company?.name ?? null,
  })
  const { html, text } = buildJobMessageEmail({
    projectName: jobName,
    subject,
    body: bodyText,
    agentName: me.name,
  })

  // Same transition-period visibility contract as every other sales send
  // (lib/email/teamVisibility): the desk is CC'd so nobody answers the
  // same client twice, and the client's reply is routed to the SENDING
  // AGENT — a mailbox HQ ingests, so the answer comes back in here.
  const team = await channelRecipients('sales-team-cc')
  const seen = new Set([to, ...cc])
  const ccWithTeam = [...cc]
  for (const t of team) {
    const a = t.trim().toLowerCase()
    if (a && !seen.has(a)) {
      seen.add(a)
      ccWithTeam.push(a)
    }
  }

  const result = await sendAgreementEmail({
    to: [to],
    cc: ccWithTeam.length > 0 ? ccWithTeam : undefined,
    replyTo: agentReplyTo(me.email) ?? undefined,
    subject,
    html,
    text,
    label: 'job-email',
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason || 'Send failed.' }, { status: 502 })
  }

  // Everything below is best-effort: the email has gone out, and a filing
  // failure is not a failed send. It is reported, not thrown.
  let threadId: string | null = null
  if (payload.threadId) {
    const existing = await prisma.emailThread.findFirst({
      where: { id: payload.threadId, jobId: job.id },
      select: { id: true },
    })
    threadId = existing?.id ?? null
  }
  if (!threadId) threadId = await startThreadForJob({ jobId: job.id, subject })

  let filed = false
  if (threadId) {
    await fileThreadInJobIfUnfiled(threadId, job.id)
    const recorded = await recordOutboundOnThread({
      threadId,
      staffEmail: me.email,
      toAddresses: [to],
      ccAddresses: cc,
      subject,
      bodyText: text,
      bodyHtml: html,
    })
    filed = !!recorded
  }

  return NextResponse.json({ ok: true, to, cc: ccWithTeam, threadId, filed })
}
