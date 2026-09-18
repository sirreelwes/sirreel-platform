/**
 * The job Conversation — the server half (reads, notes, claim).
 *
 * Phase 2 of one-thread-per-job. The stream is a READ across every
 * EmailThread filed to the job (canonical messages only — cross-inbox
 * duplicates are folded by duplicateOfId) plus the job's internal notes,
 * merged by time. Nothing here copies mail anywhere; the emails stay in
 * email_messages where the ingest and Phase 1 put them.
 *
 * Fails soft on the two Phase 2 tables until scripts/add-job-thread-tables.ts
 * has run: the emails still show, notes read as none, the claim reads as
 * none, and a write says which script is missing.
 */

import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripQuotedReply } from '@/lib/email/strip-quote'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { COPY_RECIPIENTS } from '@/lib/email/copyRecipients'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import { jobRootThreadKey, jobThreadAddress, normalizeSubject, rootSubjectFor } from '@/lib/email/jobThreadRules'
import { sendTracked } from '@/lib/sms/threads'
import {
  alertSummary,
  applyClaim,
  awaitingReply,
  bareAddress,
  claimLabel,
  cleanNote,
  kindFor,
  labelDetail,
  labelFromTriageNotes,
  laneFor,
  mentionsIn,
  mergeTimeline,
  systemLabel,
  urgentPlan,
  urgentSmsText,
  type AlertChannel,
  type ClaimAction,
  type ClaimState,
  isTagSuggested,
  type ConversationKind,
  type ConversationLane,
} from '@/lib/email/conversationRules'

const MISSING_TABLE_HINT = 'The Conversation tables are not in the database yet — an admin runs "Create the job Conversation tables" on /admin/maintenance (or `npx tsx scripts/add-job-thread-tables.ts`).'

function isMissingTable(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')
}

export interface Actor {
  id: string
  email: string
  name: string | null
  role: string
}

/** The signed-in HQ user, or null. Same lookup every job route makes. */
export async function conversationActor(): Promise<Actor | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, name: true, role: true },
  })
  return user ?? null
}

export interface StaffLite {
  id: string
  name: string
  email: string
  role: string
  /** On the note composer's chip row? False hides the suggestion only —
   *  an @mention typed by hand still tags and still texts them. */
  suggested: boolean
}

async function staffList(): Promise<StaffLite[]> {
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, isActive: true } })
  return users.filter((u) => u.isActive !== false).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email.toLowerCase(),
    role: String(u.role),
    suggested: isTagSuggested({ name: u.name, email: u.email }),
  }))
}

export interface EmailRow {
  kind: 'email'
  id: string
  who: ConversationKind
  lane: ConversationLane
  at: string
  fromAddress: string
  fromName: string
  toAddresses: string[]
  cc: string | null
  subject: string
  /** The message as the reader wants it: quoted history stripped off a client reply. */
  body: string
  snippet: string | null
  attachmentCount: number
  label: string | null
  systemLabel: string | null
  detail: string | null
  autoReply: boolean
}

export interface NoteAlert {
  userId: string
  name: string
  channel: AlertChannel
  /** SENT | FAILED | SKIPPED */
  status: string
}

export interface NoteRow {
  kind: 'note'
  id: string
  at: string
  authorUserId: string
  authorName: string
  body: string
  mentions: string[]
  anchoredEmailMessageId: string | null
  /** True when the note was sent with the Urgent toggle — it has alert rows. */
  urgent: boolean
  alerts: NoteAlert[]
  /** "texted Ana · emailed Julian" — empty for a plain note. */
  alertSummary: string
}

export interface Conversation {
  job: { id: string; jobCode: string; name: string }
  subject: string
  address: string
  claim: ClaimState & { label: string | null; claimedByName: string | null }
  staff: StaffLite[]
  items: Array<EmailRow | NoteRow>
  awaitingReply: boolean
  /** False until scripts/add-job-thread-tables.ts has run. */
  notesAvailable: boolean
  missingTableHint: string | null
}

function displayName(fromHeader: string, staff: StaffLite[]): string {
  const addr = bareAddress(fromHeader)
  const s = staff.find((u) => u.email === addr)
  if (s) return s.name
  const m = fromHeader.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/)
  if (m && m[1].trim()) return m[1].trim()
  return addr || fromHeader
}

export async function loadConversation(jobId: string): Promise<Conversation | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, jobCode: true, name: true, company: { select: { name: true } } },
  })
  if (!job) return null
  const jobName = resolveDisplayJobName({ jobName: job.name, companyName: job.company?.name ?? null })

  const [staff, emails, root, newestThread] = await Promise.all([
    staffList(),
    prisma.emailMessage.findMany({
      where: { thread: { is: { jobId } }, duplicateOfId: null },
      orderBy: { sentAt: 'asc' },
      take: 300,
      select: {
        id: true,
        fromAddress: true,
        toAddresses: true,
        subject: true,
        snippet: true,
        bodyText: true,
        direction: true,
        sentAt: true,
        attachmentCount: true,
        routingHeaders: true,
        triageNotes: true,
        autoReply: true,
      },
    }),
    prisma.emailThread.findUnique({ where: { gmailThreadId: jobRootThreadKey(jobId) }, select: { subject: true } }),
    prisma.emailThread.findFirst({
      where: { jobId, messageCount: { gt: 0 } },
      orderBy: { lastMessageAt: 'desc' },
      select: { subject: true },
    }),
  ])

  const staffByEmail = new Map(staff.map((s) => [s.email, s]))
  const emailRows: Array<EmailRow & { atDate: Date }> = emails.map((m) => {
    const who = kindFor({ direction: m.direction, fromAddress: m.fromAddress })
    const rh = (m.routingHeaders ?? null) as { deliveredTo?: string | null; cc?: string | null } | null
    const author = staffByEmail.get(bareAddress(m.fromAddress))
    const label = labelFromTriageNotes(m.triageNotes)
    const lane = laneFor({
      kind: who,
      fromAddress: m.fromAddress,
      deliveredTo: rh?.deliveredTo ?? null,
      toAddresses: m.toAddresses,
      ccAddresses: rh?.cc ?? null,
      authorRole: author?.role ?? null,
      label,
    })
    const raw = m.bodyText || m.snippet || ''
    return {
      kind: 'email',
      id: m.id,
      who,
      lane,
      at: m.sentAt.toISOString(),
      atDate: m.sentAt,
      fromAddress: bareAddress(m.fromAddress),
      fromName: who === 'system' ? 'SirReel HQ' : displayName(m.fromAddress, staff),
      toAddresses: m.toAddresses,
      cc: rh?.cc ?? null,
      subject: m.subject,
      body: who === 'client' ? stripQuotedReply(raw) : raw,
      snippet: m.snippet,
      attachmentCount: m.attachmentCount,
      label,
      systemLabel: who === 'system' ? systemLabel(label) : null,
      detail: who === 'system' ? labelDetail(label) : null,
      autoReply: m.autoReply,
    }
  })

  // Notes + claim — the Phase 2 tables. Fail soft until they exist.
  let notesAvailable = true
  let noteRows: Array<NoteRow & { atDate: Date }> = []
  let claimRow: { claimedByUserId: string | null; claimedLane: string | null; claimedAt: Date | null } | null = null
  try {
    const [notes, claim] = await Promise.all([
      prisma.jobThreadNote.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' }, take: 500 }),
      prisma.jobThreadState.findUnique({ where: { jobId } }),
    ])
    const staffById = new Map(staff.map((s) => [s.id, s]))
    // Urgent-note alerts — a third table, added after the first two. Its
    // own try: a missing alerts table must not hide the notes.
    const alertsByNote = new Map<string, NoteAlert[]>()
    try {
      const alerts = await prisma.jobThreadAlert.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' }, take: 2000 })
      for (const a of alerts) {
        const list = alertsByNote.get(a.noteId) ?? []
        list.push({ userId: a.userId, name: staffById.get(a.userId)?.name ?? 'Someone', channel: a.channel as AlertChannel, status: a.status })
        alertsByNote.set(a.noteId, list)
      }
    } catch (err) {
      if (!isMissingTable(err)) throw err
    }
    noteRows = notes.map((n) => {
      const alerts = alertsByNote.get(n.id) ?? []
      return {
        kind: 'note',
        id: n.id,
        at: n.createdAt.toISOString(),
        atDate: n.createdAt,
        authorUserId: n.authorUserId,
        authorName: staffById.get(n.authorUserId)?.name ?? 'Someone',
        body: n.body,
        mentions: n.mentions,
        anchoredEmailMessageId: n.anchoredEmailMessageId,
        urgent: alerts.length > 0,
        alerts,
        alertSummary: alertSummary(alerts),
      }
    })
    claimRow = claim
  } catch (err) {
    if (!isMissingTable(err)) throw err
    notesAvailable = false
  }

  const merged = mergeTimeline(
    emailRows.map((e) => ({ ...e, at: e.atDate })),
    noteRows.map((n) => ({ ...n, at: n.atDate })),
  )
  const items: Array<EmailRow | NoteRow> = merged.map((r) => {
    const { atDate, ...rest } = r as typeof r & { atDate: Date }
    return { ...rest, at: atDate.toISOString() } as EmailRow | NoteRow
  })

  const claimState: ClaimState = {
    claimedByUserId: claimRow?.claimedByUserId ?? null,
    claimedLane: (claimRow?.claimedLane as ConversationLane | null) ?? null,
    claimedAt: claimRow?.claimedAt ?? null,
  }
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? null

  const rootSubject =
    root?.subject ??
    rootSubjectFor({ jobName, jobCode: job.jobCode, filedSubject: newestThread?.subject ?? null })

  return {
    job: { id: job.id, jobCode: job.jobCode, name: jobName },
    subject: normalizeSubject(rootSubject),
    address: jobThreadAddress(job.jobCode),
    claim: {
      ...claimState,
      label: claimLabel(claimState, nameOf),
      claimedByName: claimState.claimedByUserId ? nameOf(claimState.claimedByUserId) : null,
    },
    staff,
    items,
    awaitingReply: awaitingReply(emailRows.map((e) => ({ kind: e.who, at: e.atDate }))),
    notesAvailable,
    missingTableHint: notesAvailable ? null : MISSING_TABLE_HINT,
  }
}

/**
 * For the /jobs rail: is the client waiting on us, per job, in one query.
 * Reads the thread-level timestamps the ingest maintains, so it costs one
 * groupBy for the whole page rather than a message scan per job.
 */
export async function conversationSummaryForJobs(
  jobIds: string[],
): Promise<Map<string, { awaitingReply: boolean; lastInboundAt: string | null }>> {
  const out = new Map<string, { awaitingReply: boolean; lastInboundAt: string | null }>()
  if (jobIds.length === 0) return out
  try {
    const rows = await prisma.emailThread.groupBy({
      by: ['jobId'],
      where: { jobId: { in: jobIds } },
      _max: { lastInboundAt: true, lastOutboundAt: true },
    })
    for (const r of rows) {
      if (!r.jobId) continue
      const lastIn = r._max.lastInboundAt
      const lastOut = r._max.lastOutboundAt
      out.set(r.jobId, {
        awaitingReply: !!lastIn && (!lastOut || lastIn > lastOut),
        lastInboundAt: lastIn ? lastIn.toISOString() : null,
      })
    }
  } catch (err) {
    console.warn('[jobConversation] summary failed (non-blocking):', err instanceof Error ? err.message : err)
  }
  return out
}

export type NoteResult = { ok: true; note: NoteRow } | { ok: false; status: number; error: string }

/**
 * An URGENT note reaches every tagged person right now (Wes 2026-09-17):
 * a text to the mobile on file (User.phone — the number set on
 * /admin/assistant), an email when there is no mobile, and an honest
 * "unreachable" when there is neither. Sent as `source: 'staff'`, which is
 * exempt from quiet hours — a person pressed Urgent at that hour on
 * purpose. Every outcome is written to sr_job_thread_alerts (best-effort:
 * a missing table costs the record, never the text) and to the audit log.
 */
async function raiseUrgentAlerts(args: {
  jobId: string
  noteId: string
  actor: Actor
  body: string
  mentions: string[]
  job: { jobCode: string; name: string }
}): Promise<NoteAlert[]> {
  const users = await prisma.user.findMany({
    where: { id: { in: args.mentions } },
    select: { id: true, name: true, email: true, phone: true, isActive: true },
  })
  const plan = urgentPlan({
    mentions: args.mentions,
    authorUserId: args.actor.id,
    staff: users.filter((u) => u.isActive !== false),
  })
  const byName = args.actor.name || args.actor.email
  const url = `${HQ_APP_URL}/jobs/${args.jobId}?tab=conversation`
  const out: Array<NoteAlert & { sentTo: string | null; detail: string | null }> = []

  for (const t of plan) {
    let status = 'SKIPPED'
    let detail: string | null = null
    if (t.channel === 'SMS' && t.to) {
      const r = await sendTracked({
        to: t.to,
        body: urgentSmsText({ byName, jobName: args.job.name, jobCode: args.job.jobCode, body: args.body, url }),
        source: 'staff',
        jobId: args.jobId,
        sentById: args.actor.id,
      })
      status = r.ok ? 'SENT' : 'FAILED'
      detail = r.ok ? null : r.error ?? r.status
    } else if (t.channel === 'EMAIL' && t.to) {
      const subject = `URGENT · ${args.job.name} (${args.job.jobCode}) — ${byName}`
      const text = `${byName} flagged this as urgent on ${args.job.name} (${args.job.jobCode}):\n\n${args.body}\n\nOpen the conversation: ${url}`
      const html = `<p><strong>${esc(byName)}</strong> flagged this as urgent on <strong>${esc(args.job.name)}</strong> (${esc(args.job.jobCode)}):</p><blockquote style="border-left:3px solid #7c3aed;margin:12px 0;padding:8px 12px;white-space:pre-wrap">${esc(args.body)}</blockquote><p><a href="${url}">Open the conversation →</a></p>`
      const r = await sendAgreementEmail({ to: [t.to], subject, html, text, label: 'job-thread-urgent' })
      status = r.ok ? 'SENT' : 'FAILED'
      detail = r.ok ? null : r.reason
    } else {
      detail = 'no mobile or email on file'
    }
    out.push({ userId: t.userId, name: t.name, channel: t.channel, status, sentTo: t.to, detail })
  }

  if (out.length) {
    await prisma.jobThreadAlert
      .createMany({
        data: out.map((a) => ({ jobId: args.jobId, noteId: args.noteId, userId: a.userId, channel: a.channel, status: a.status, sentTo: a.sentTo, detail: a.detail })),
      })
      .catch((err) => {
        if (!isMissingTable(err)) throw err
        console.warn('[jobConversation] alerts table missing — urgent sends went out but were not recorded; run "Create the job Conversation tables" again')
      })
  }
  await prisma.auditLog
    .create({
      data: {
        userId: args.actor.id,
        action: 'job.note_urgent',
        entityType: 'Job',
        entityId: args.jobId,
        newValues: { noteId: args.noteId, alerts: out.map((a) => ({ userId: a.userId, channel: a.channel, status: a.status })) },
      },
    })
    .catch((e) => console.error('[jobConversation] urgent audit failed', e))
  return out.map(({ sentTo: _s, detail: _d, ...a }) => a)
}

export async function addNote(args: {
  jobId: string
  actor: Actor
  body: unknown
  anchoredEmailMessageId?: string | null
  /** Reach every tagged person now (text, else email). Refused with nobody tagged. */
  urgent?: boolean
}): Promise<NoteResult> {
  const body = cleanNote(args.body)
  if (!body) return { ok: false, status: 400, error: 'The note is empty.' }
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: { id: true, jobCode: true, name: true, company: { select: { name: true } } },
  })
  if (!job) return { ok: false, status: 404, error: 'job not found' }

  let anchored: string | null = null
  if (typeof args.anchoredEmailMessageId === 'string' && args.anchoredEmailMessageId) {
    const m = await prisma.emailMessage.findFirst({
      where: { id: args.anchoredEmailMessageId, thread: { is: { jobId: args.jobId } } },
      select: { id: true },
    })
    anchored = m?.id ?? null
  }

  const staff = await staffList()
  const mentions = mentionsIn(body, staff)
  const urgent = args.urgent === true
  if (urgent && mentions.filter((id) => id !== args.actor.id).length === 0) {
    return { ok: false, status: 400, error: 'Tag someone with @Name first — an urgent note has to have someone to reach.' }
  }
  let note: { id: string; createdAt: Date }
  try {
    note = await prisma.jobThreadNote.create({
      data: { jobId: args.jobId, authorUserId: args.actor.id, body, mentions, anchoredEmailMessageId: anchored },
    })
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, status: 503, error: MISSING_TABLE_HINT }
    throw err
  }
  await prisma.auditLog
    .create({
      data: {
        userId: args.actor.id,
        action: 'job.note_added',
        entityType: 'Job',
        entityId: args.jobId,
        newValues: { noteId: note.id, mentions, anchoredEmailMessageId: anchored, length: body.length, urgent },
      },
    })
    .catch((e) => console.error('[jobConversation] note audit failed', e))

  // The note is saved; the alerts are the second half. A failure here is
  // reported per person, never as a failed note.
  let alerts: NoteAlert[] = []
  if (urgent) {
    try {
      alerts = await raiseUrgentAlerts({
        jobId: args.jobId,
        noteId: note.id,
        actor: args.actor,
        body,
        mentions,
        job: { jobCode: job.jobCode, name: resolveDisplayJobName({ jobName: job.name, companyName: job.company?.name ?? null }) },
      })
    } catch (err) {
      console.error('[jobConversation] urgent alerts failed', err)
    }
  }
  return {
    ok: true,
    note: {
      kind: 'note',
      id: note.id,
      at: note.createdAt.toISOString(),
      authorUserId: args.actor.id,
      authorName: args.actor.name ?? 'You',
      body,
      mentions,
      anchoredEmailMessageId: anchored,
      urgent: alerts.length > 0,
      alerts,
      alertSummary: alertSummary(alerts),
    },
  }
}

export type ClaimResult =
  | { ok: true; claim: ClaimState & { label: string | null }; notified: string[] }
  | { ok: false; status: number; error: string }

const HQ_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/**
 * Claim / hand / release. "Hand to Billing" also emails the billing desk
 * (the same recipients billing copies go to) with a link straight to the
 * job's Conversation — the ping Ana reads before the client's next reply.
 */
export async function applyClaimForJob(args: { jobId: string; actor: Actor; action: ClaimAction }): Promise<ClaimResult> {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: { id: true, jobCode: true, name: true, company: { select: { name: true } } },
  })
  if (!job) return { ok: false, status: 404, error: 'job not found' }

  let current: ClaimState = { claimedByUserId: null, claimedLane: null, claimedAt: null }
  try {
    const row = await prisma.jobThreadState.findUnique({ where: { jobId: args.jobId } })
    if (row) {
      current = {
        claimedByUserId: row.claimedByUserId,
        claimedLane: (row.claimedLane as ConversationLane | null) ?? null,
        claimedAt: row.claimedAt,
      }
    }
    const next = applyClaim(current, args.action, new Date())
    await prisma.jobThreadState.upsert({
      where: { jobId: args.jobId },
      create: { jobId: args.jobId, ...next },
      update: next,
    })
    const staff = await staffList()
    const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? null
    const label = claimLabel(next, nameOf)

    await prisma.auditLog
      .create({
        data: {
          userId: args.actor.id,
          action:
            args.action.action === 'claim' ? 'job.thread_claimed' : args.action.action === 'hand' ? 'job.thread_handed' : 'job.thread_released',
          entityType: 'Job',
          entityId: args.jobId,
          oldValues: { ...current, claimedAt: current.claimedAt?.toISOString() ?? null },
          newValues: { ...next, claimedAt: next.claimedAt?.toISOString() ?? null },
        },
      })
      .catch((e) => console.error('[jobConversation] claim audit failed', e))

    // The hand-off ping. Billing only — sales lives on the /jobs rail and
    // sees "client replied" there; billing works from email.
    let notified: string[] = []
    if (args.action.action === 'hand' && args.action.lane === 'BILLING') {
      const jobName = resolveDisplayJobName({ jobName: job.name, companyName: job.company?.name ?? null })
      const link = `${HQ_APP_URL}/jobs/${job.id}?tab=conversation`
      const to = [...COPY_RECIPIENTS.billing]
      const who = args.actor.name || args.actor.email
      const text = `${who} handed the conversation on ${jobName} (${job.jobCode}) to Billing.\n\nOpen it: ${link}\n\nReply to the client from there and the thread stays on the job.`
      const html = `<p>${esc(who)} handed the conversation on <b>${esc(jobName)}</b> (${esc(job.jobCode)}) to Billing.</p><p><a href="${esc(link)}">Open the conversation</a></p><p style="color:#666">Reply to the client from there and the thread stays on the job.</p>`
      const r = await sendAgreementEmail({
        to,
        replyTo: args.actor.email,
        subject: `Handed to Billing — ${jobName} (${job.jobCode})`,
        html,
        text,
        label: 'job-thread-handoff',
      })
      if (r.ok) notified = to
      else console.warn('[jobConversation] hand-off email failed:', r.reason)
    }

    return { ok: true, claim: { ...next, label }, notified }
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, status: 503, error: MISSING_TABLE_HINT }
    throw err
  }
}
