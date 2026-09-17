/**
 * The Chat page — every job conversation YOU are in, across all jobs.
 *
 * Wes 2026-09-17: "let's create a chat tab on the left menu for everyone,
 * which is kind of the reverse, meaning all chats, no matter which job,
 * will show up here … It's another way to communicate if you're not
 * already in the job." Then, immediately: "the chats shouldn't be for
 * everyone. It should be for everyone who is included in that chat. In
 * other words if it was directly @billing, it wouldn't show up in Hugo's
 * and vice versa."
 *
 * So this is an INCLUSION query, not a listing. A job reaches your page
 * only for a reason, the row names the reason, and the reasons are:
 *
 *   mentioned — @you in a note there
 *   holding   — you hold the claim
 *   wrote     — you wrote a note, or sent/received mail on the thread
 *   rep       — you are the agent on the job
 *   desk      — handed to Billing (or it landed in a billing inbox) and
 *               you are the billing desk
 *
 * Hugo is none of those on a job Ana was tagged on, so it is not in his
 * list — which is the whole of Wes's rule.
 *
 * Everything reads what is already there (notes, the claim, email_messages,
 * Job.agentId). There is no read/unread table and this does not add one:
 * the "needs you" signals are DERIVED — a note tagged you and you have not
 * written since, or the client's newest message is newer than our newest
 * send. `sortChatRows` in conversationRules puts those at the top.
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import {
  bareAddress,
  chatPreview,
  inclusionLabel,
  isBillingDesk,
  kindFor,
  sortChatRows,
  type ChatReason,
  type ConversationKind,
} from '@/lib/email/conversationRules'
import type { Actor } from '@/lib/email/jobConversation'

/** How far back a conversation counts as live enough to carry. */
const LOOKBACK_DAYS = 45
/** Hard caps so one busy desk cannot turn this into a table scan. */
const MAX_JOBS = 60
const PER_QUERY = 400

const BILLING_INBOX_LIST = ['billing@sirreel.com', 'payments@sirreel.com', 'ana@sirreel.com']

function isMissingTable(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')
}

export interface ChatRow {
  jobId: string
  jobCode: string
  /** The production, resolved the same way the job page resolves it. */
  jobName: string
  /** Named on every row, on purpose — a reply box with no company above it
   *  is how a note lands on the wrong show (Wes: "it needs to be very clear
   *  what company and job it is referring to"). */
  companyName: string | null
  /** Newest thing on the conversation, whoever wrote it. */
  lastAt: string
  lastKind: ConversationKind | 'note'
  lastWho: string
  lastPreview: string
  /** Why this is in YOUR list. Rendered on the row. */
  reasons: ChatReason[]
  reasonLabel: string
  awaitingReply: boolean
  taggedMe: boolean
  urgentForMe: boolean
  claimLabel: string | null
}

export interface ChatInbox {
  rows: ChatRow[]
  /** False until the Conversation tables exist — notes/claim read as none. */
  notesAvailable: boolean
  /** Rows dropped by the cap, so the page can say the list is not everything. */
  truncated: boolean
}

type Bucket = { reasons: Set<ChatReason>; taggedAt: Date | null; urgentAt: Date | null; myLastWriteAt: Date | null }

function bucket(map: Map<string, Bucket>, jobId: string): Bucket {
  let b = map.get(jobId)
  if (!b) {
    b = { reasons: new Set(), taggedAt: null, urgentAt: null, myLastWriteAt: null }
    map.set(jobId, b)
  }
  return b
}

const newer = (a: Date | null, b: Date) => (a && a.getTime() >= b.getTime() ? a : b)

/**
 * The jobs this person is in, with the reason for each. Every query is
 * bounded and every Phase 2 table fails soft, so the page still renders
 * (from mail and jobs alone) before the tables exist.
 */
async function includedJobs(actor: Actor, since: Date): Promise<{ map: Map<string, Bucket>; notesAvailable: boolean }> {
  const map = new Map<string, Bucket>()
  const email = bareAddress(actor.email)
  let notesAvailable = true

  // ── Notes: tagged you, or written by you ──────────────────────────
  try {
    const notes = await prisma.jobThreadNote.findMany({
      where: { createdAt: { gte: since }, OR: [{ mentions: { has: actor.id } }, { authorUserId: actor.id }] },
      orderBy: { createdAt: 'desc' },
      take: PER_QUERY,
      select: { id: true, jobId: true, mentions: true, authorUserId: true, createdAt: true },
    })
    const taggedNoteIds: string[] = []
    for (const n of notes) {
      const b = bucket(map, n.jobId)
      if (n.authorUserId === actor.id) {
        b.reasons.add('wrote')
        b.myLastWriteAt = newer(b.myLastWriteAt, n.createdAt)
      }
      // Your own note naming you is not a tag on you.
      if (n.mentions.includes(actor.id) && n.authorUserId !== actor.id) {
        b.reasons.add('mentioned')
        b.taggedAt = newer(b.taggedAt, n.createdAt)
        taggedNoteIds.push(n.id)
      }
    }
    // Which of those tags were URGENT — the alert rows are the marker.
    if (taggedNoteIds.length) {
      try {
        const alerts = await prisma.jobThreadAlert.findMany({
          where: { noteId: { in: taggedNoteIds }, userId: actor.id },
          select: { jobId: true, createdAt: true },
        })
        for (const a of alerts) {
          const b = bucket(map, a.jobId)
          b.urgentAt = newer(b.urgentAt, a.createdAt)
        }
      } catch (err) {
        if (!isMissingTable(err)) throw err
      }
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err
    notesAvailable = false
  }

  // ── The claim: you hold it, or it is handed to your desk ──────────
  try {
    const billing = isBillingDesk({ role: actor.role, email: actor.email })
    const claims = await prisma.jobThreadState.findMany({
      where: {
        OR: [{ claimedByUserId: actor.id }, ...(billing ? [{ claimedLane: 'BILLING' }] : [])],
      },
      take: PER_QUERY,
      select: { jobId: true, claimedByUserId: true, claimedLane: true },
    })
    for (const c of claims) {
      const b = bucket(map, c.jobId)
      if (c.claimedByUserId === actor.id) b.reasons.add('holding')
      else if (billing && c.claimedLane === 'BILLING') b.reasons.add('desk')
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err
    notesAvailable = false
  }

  // ── Mail: you sent it, or you were on it ──────────────────────────
  if (email) {
    const mine = await prisma.emailMessage.findMany({
      where: {
        sentAt: { gte: since },
        duplicateOfId: null,
        thread: { is: { jobId: { not: null } } },
        // Cc is not a column on EmailMessage (it lives in routingHeaders
        // JSON), so this matches From and To. Being Cc'd and nothing else
        // does not pull a job in — every other reason still can.
        OR: [{ fromAddress: { contains: email, mode: 'insensitive' } }, { toAddresses: { has: email } }],
      },
      orderBy: { sentAt: 'desc' },
      take: PER_QUERY,
      select: { sentAt: true, fromAddress: true, thread: { select: { jobId: true } } },
    })
    for (const m of mine) {
      const jobId = m.thread?.jobId
      if (!jobId) continue
      const b = bucket(map, jobId)
      b.reasons.add('wrote')
      if (bareAddress(m.fromAddress) === email && m.sentAt) b.myLastWriteAt = newer(b.myLastWriteAt, m.sentAt)
    }
  }

  // ── The billing desk also sees what landed in its inboxes ─────────
  if (isBillingDesk({ role: actor.role, email: actor.email })) {
    const landed = await prisma.emailMessage.findMany({
      where: {
        sentAt: { gte: since },
        duplicateOfId: null,
        thread: { is: { jobId: { not: null } } },
        toAddresses: { hasSome: BILLING_INBOX_LIST },
      },
      orderBy: { sentAt: 'desc' },
      take: PER_QUERY,
      select: { thread: { select: { jobId: true } } },
    })
    for (const m of landed) {
      const jobId = m.thread?.jobId
      if (jobId) bucket(map, jobId).reasons.add('desk')
    }
  }

  // ── Your own jobs — you are the rep ───────────────────────────────
  const mineJobs = await prisma.job.findMany({
    // No emailThreads back-relation on Job, so this takes your recent jobs
    // and the "nothing written on it yet = not a conversation" filter at the
    // bottom drops the ones with no activity.
    where: { agentId: actor.id, archivedAt: null },
    orderBy: { updatedAt: 'desc' },
    take: MAX_JOBS,
    select: { id: true },
  })
  for (const j of mineJobs) bucket(map, j.id).reasons.add('rep')

  for (const [jobId, b] of map) if (b.reasons.size === 0) map.delete(jobId)
  return { map, notesAvailable }
}

/** A teammate by name, anyone else by address — the panel's own rule. */
function senderName(fromAddress: string, staffByEmail: Map<string, string>): string {
  const addr = bareAddress(fromAddress)
  return staffByEmail.get(addr) ?? addr
}

/** Newest activity per job — one query for mail, one for notes. */
async function newestActivity(jobIds: string[], staffById: Map<string, string>, staffByEmail: Map<string, string>) {
  const out = new Map<string, { at: Date; kind: ConversationKind | 'note'; who: string; preview: string }>()
  if (jobIds.length === 0) return out

  const emails = await prisma.emailMessage.findMany({
    where: { duplicateOfId: null, thread: { is: { jobId: { in: jobIds } } } },
    orderBy: { sentAt: 'desc' },
    take: PER_QUERY * 2,
    select: {
      sentAt: true,
      direction: true,
      fromAddress: true,
      subject: true,
      snippet: true,
      bodyText: true,
      thread: { select: { jobId: true } },
    },
  })
  for (const m of emails) {
    const jobId = m.thread?.jobId
    if (!jobId || !m.sentAt || out.has(jobId)) continue
    const kind = kindFor({ direction: m.direction, fromAddress: m.fromAddress })
    out.set(jobId, {
      at: m.sentAt,
      kind,
      who: kind === 'system' ? 'HQ' : senderName(m.fromAddress, staffByEmail),
      preview: chatPreview(m.snippet || m.bodyText || m.subject),
    })
  }

  try {
    const notes = await prisma.jobThreadNote.findMany({
      where: { jobId: { in: jobIds } },
      orderBy: { createdAt: 'desc' },
      take: PER_QUERY,
      select: { jobId: true, createdAt: true, authorUserId: true, body: true },
    })
    for (const n of notes) {
      const cur = out.get(n.jobId)
      if (cur && cur.at.getTime() >= n.createdAt.getTime()) continue
      out.set(n.jobId, {
        at: n.createdAt,
        kind: 'note',
        who: staffById.get(n.authorUserId) ?? 'Someone',
        preview: chatPreview(n.body),
      })
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err
  }
  return out
}

export async function chatInboxFor(actor: Actor): Promise<ChatInbox> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
  const { map, notesAvailable } = await includedJobs(actor, since)
  if (map.size === 0) return { rows: [], notesAvailable, truncated: false }

  const jobIds = [...map.keys()]
  const [jobs, staff, threads] = await Promise.all([
    prisma.job.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, jobCode: true, name: true, company: { select: { name: true } } },
    }),
    prisma.user.findMany({ select: { id: true, name: true, email: true } }),
    // The claim label, and the two timestamps that say who is waiting.
    prisma.emailThread.groupBy({
      by: ['jobId'],
      where: { jobId: { in: jobIds } },
      _max: { lastInboundAt: true, lastOutboundAt: true },
    }),
  ])
  const staffById = new Map(staff.map((s) => [s.id, s.name]))
  const staffByEmail = new Map(staff.map((s) => [s.email.toLowerCase(), s.name]))
  const activity = await newestActivity(jobIds, staffById, staffByEmail)

  let claims = new Map<string, { claimedByUserId: string | null; claimedLane: string | null }>()
  try {
    const rows = await prisma.jobThreadState.findMany({ where: { jobId: { in: jobIds } } })
    claims = new Map(rows.map((r) => [r.jobId, { claimedByUserId: r.claimedByUserId, claimedLane: r.claimedLane }]))
  } catch (err) {
    if (!isMissingTable(err)) throw err
  }

  const waiting = new Map(
    threads.map((t) => {
      const inb = t._max.lastInboundAt
      const out = t._max.lastOutboundAt
      return [t.jobId as string, !!inb && (!out || inb > out)]
    }),
  )

  const rows = jobs.flatMap((job) => {
    const b = map.get(job.id)
    const last = activity.get(job.id)
    // No mail and no note = nothing to show. A job you are the rep on but
    // nobody has written on yet is not a conversation.
    if (!b || !last) return []
    const claim = claims.get(job.id)
    const claimLabel = claim?.claimedByUserId
      ? `${staffById.get(claim.claimedByUserId) ?? 'Someone'} is answering`
      : claim?.claimedLane
        ? `Handed to ${claim.claimedLane === 'BILLING' ? 'Billing' : 'Sales'}`
        : null
    // "Still on you" = they tagged you and you have not written since.
    const answered = b.myLastWriteAt && b.taggedAt && b.myLastWriteAt.getTime() > b.taggedAt.getTime()
    const taggedMe = !!b.taggedAt && !answered
    const urgentForMe = !!b.urgentAt && !answered
    const reasons = [...b.reasons]
    return [
      {
        jobId: job.id,
        jobCode: job.jobCode,
        jobName: resolveDisplayJobName({ jobName: job.name, companyName: job.company?.name ?? null }),
        companyName: job.company?.name ?? null,
        lastAt: last.at,
        lastKind: last.kind,
        lastWho: last.who,
        lastPreview: last.preview,
        reasons,
        reasonLabel: inclusionLabel(reasons),
        awaitingReply: waiting.get(job.id) ?? false,
        taggedMe,
        urgentForMe,
        claimLabel,
      },
    ]
  })

  const sorted = sortChatRows(rows)
  return {
    rows: sorted.slice(0, MAX_JOBS).map((r) => ({ ...r, lastAt: r.lastAt.toISOString() })),
    notesAvailable,
    truncated: sorted.length > MAX_JOBS,
  }
}
