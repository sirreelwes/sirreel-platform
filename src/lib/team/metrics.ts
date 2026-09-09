import { prisma } from '@/lib/prisma'
import { WATCHED_PEOPLE, type WatchedPerson } from '@/lib/team/watched'

/**
 * What the team desk actually measures, and — as importantly — what each
 * number is not.
 *
 * ── The one rule this file is built around ────────────────────────────────
 * Every number is compared to the SAME PERSON in the previous window of the
 * same length. Nothing is ranked across people. That is not politeness, it
 * is arithmetic: Ana's outcome lives in RwInvoicePaidMark and
 * RwCollectionCharge, a rep's lives in Order.bookedTotal, and her inbound
 * mail passes a positive-only ingest filter while theirs passes a negative
 * junk filter. There is no shared denominator, so a shared ranking would be
 * an artifact of role, not of effort.
 *
 * ── Three known measurement traps, handled here ───────────────────────────
 *
 * 1. CROSS-INBOX DUPLICATES. billing@/payments@/jobs@ forward into ana@ and
 *    the ingest dedups by RFC-822 Message-ID, marking the later copies
 *    `duplicateOfId`. Filtering on `duplicateOfId: null` per inbox
 *    under-counts her; not filtering double-counts her. Both queries below
 *    therefore fetch every copy in her mailboxes and dedupe in memory on
 *    rfc822MessageId, so each real message counts exactly once no matter
 *    which inbox won.
 *
 * 2. PaymentLog.logged_by DEFAULTS TO 'ana@sirreel.com' at the schema level.
 *    It is not attribution — it is a default that silently credits her for
 *    rows nobody attributed. This file never reads that table. Ana's
 *    collections numbers come from RwCollectionCharge.chargedById and
 *    RwInvoicePaidMark.markedById, which are real user ids.
 *
 * 3. AUTO-REPLIES. Oliver's vacation responder already muted a live lead
 *    once (2026-09-08). An auto-reply is not work: `autoReply: false` on
 *    every outbound count, and an auto-reply never closes a response-time
 *    measurement.
 *
 * ── What none of this sees ────────────────────────────────────────────────
 * Phone calls, anything done inside RentalWorks, walk-ups, and every lead
 * worked out of the shared info@/hello@ inboxes. The effort numbers are a
 * FLOOR. A low number is a question to ask, never a finding on its own.
 */

export type Unit = 'count' | 'usd' | 'pct' | 'hours'

export interface Stat {
  key: string
  label: string
  value: number | null
  /** Same measure over the immediately preceding window of equal length. */
  prior: number | null
  unit: Unit
  /** Colours the delta. null means a change is not self-evidently good or
   *  bad and should not be painted as either. */
  betterHigher: boolean | null
  hint?: string
}

export interface PersonReport {
  email: string
  name: string
  kind: WatchedPerson['kind']
  caveat?: string
  /** False when no User row matches the roster email — every id-keyed
   *  number is then unavailable rather than zero, which reads very
   *  differently on a page about performance. */
  hasUser: boolean
  outcomes: Stat[]
  effort: Stat[]
  responsiveness: Stat[]
}

interface Window {
  from: Date
  to: Date
}

/** Raw counts for one person over one window, before prior-period pairing. */
interface Raw {
  // sales
  quotesSent: number
  ordersBooked: number
  bookedValue: number
  quoteCohort: number
  quoteCohortBooked: number
  inquiriesAssigned: number
  // collections
  chargesTaken: number
  chargedValue: number
  invoicesMarkedPaid: number
  reviewNotes: number
  // effort
  outboundEmails: number
  hqActions: number
  activeDays: number
  // responsiveness
  threadsReceived: number
  threadsAnswered: number
  medianReplyHours: number | null
  leftUnanswered: number
}

const PACIFIC = 'America/Los_Angeles'
/** Below this age an unanswered thread is still "in flight", not a miss. */
const UNANSWERED_AFTER_HOURS = 48
/** Ceiling on threads examined per person per window — the response-time
 *  pass is the only O(mail) query here. */
const THREAD_CAP = 600

function pacificDay(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: PACIFIC })
}

function bare(address: string): string {
  const m = address.match(/<([^>]+)>/)
  return (m ? m[1] : address).trim().toLowerCase()
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Every message in this person's mailboxes for the window, deduped across
 * inboxes. Returns both directions in one pass — the response-time
 * calculation needs them paired anyway.
 */
async function mailFor(person: WatchedPerson, w: Window) {
  const rows = await prisma.emailMessage.findMany({
    where: {
      sentAt: { gte: w.from, lt: w.to },
      emailAccount: { emailAddress: { in: person.inboxes } },
    },
    select: {
      id: true,
      rfc822MessageId: true,
      threadId: true,
      direction: true,
      fromAddress: true,
      sentAt: true,
      autoReply: true,
    },
    orderBy: { sentAt: 'asc' },
    take: 20000,
  })

  // One row per real message. The ingest may have stored the same
  // Message-ID in three of her mailboxes; that is one email.
  const seen = new Set<string>()
  const unique = rows.filter((r) => {
    const key = r.rfc822MessageId ?? r.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const sends = new Set(person.sendAddresses.map((a) => a.toLowerCase()))
  const outbound = unique.filter(
    (r) => r.direction === 'outbound' && !r.autoReply && sends.has(bare(r.fromAddress)),
  )
  const inbound = unique.filter((r) => r.direction === 'inbound' && !r.autoReply)
  return { outbound, inbound }
}

/**
 * Time from a thread's first inbound message in the window to this person's
 * first reply on it.
 *
 * Measured per THREAD, not per message: a client who sends four emails in a
 * row has not made the rep four times slower, and counting each one would
 * say exactly that.
 */
async function responsiveness(
  person: WatchedPerson,
  w: Window,
  inbound: { threadId: string | null; sentAt: Date }[],
): Promise<Pick<Raw, 'threadsReceived' | 'threadsAnswered' | 'medianReplyHours' | 'leftUnanswered'>> {
  const firstByThread = new Map<string, Date>()
  for (const m of inbound) {
    if (!m.threadId) continue
    const seen = firstByThread.get(m.threadId)
    if (!seen || m.sentAt < seen) firstByThread.set(m.threadId, m.sentAt)
  }
  const threadIds = [...firstByThread.keys()].slice(0, THREAD_CAP)
  if (!threadIds.length) {
    return { threadsReceived: 0, threadsAnswered: 0, medianReplyHours: null, leftUnanswered: 0 }
  }

  // Replies are looked for PAST the window end — a Friday email answered on
  // Monday is answered, and cutting at the boundary would score it as a miss.
  const replies = await prisma.emailMessage.findMany({
    where: {
      threadId: { in: threadIds },
      direction: 'outbound',
      autoReply: false,
      sentAt: { gte: w.from },
    },
    select: { threadId: true, fromAddress: true, sentAt: true },
    orderBy: { sentAt: 'asc' },
  })

  const sends = new Set(person.sendAddresses.map((a) => a.toLowerCase()))
  const firstReply = new Map<string, Date>()
  for (const r of replies) {
    if (!r.threadId || !sends.has(bare(r.fromAddress))) continue
    if (!firstReply.has(r.threadId)) firstReply.set(r.threadId, r.sentAt)
  }

  const now = Date.now()
  const hours: number[] = []
  let answered = 0
  let unanswered = 0
  for (const id of threadIds) {
    const asked = firstByThread.get(id)!
    const replied = firstReply.get(id)
    if (replied && replied > asked) {
      answered += 1
      hours.push((replied.getTime() - asked.getTime()) / 3600000)
    } else if (now - asked.getTime() > UNANSWERED_AFTER_HOURS * 3600000) {
      unanswered += 1
    }
  }

  return {
    threadsReceived: threadIds.length,
    threadsAnswered: answered,
    medianReplyHours: median(hours),
    leftUnanswered: unanswered,
  }
}

async function rawFor(person: WatchedPerson, userId: string | null, w: Window): Promise<Raw> {
  const { outbound, inbound } = await mailFor(person, w)

  const [resp, hqActions] = await Promise.all([
    responsiveness(person, w, inbound),
    userId
      ? prisma.auditLog.count({ where: { userId, createdAt: { gte: w.from, lt: w.to } } })
      : Promise.resolve(0),
  ])

  // A day counts as active if anything at all is stamped to them on it —
  // a sent email or a logged HQ action. Deliberately generous: this is a
  // presence signal, not a timesheet, and payroll is where hours live.
  const days = new Set<string>(outbound.map((m) => pacificDay(m.sentAt)))
  if (userId) {
    const acts = await prisma.auditLog.findMany({
      where: { userId, createdAt: { gte: w.from, lt: w.to } },
      select: { createdAt: true },
      take: 5000,
    })
    for (const a of acts) days.add(pacificDay(a.createdAt))
  }

  const base: Raw = {
    quotesSent: 0,
    ordersBooked: 0,
    bookedValue: 0,
    quoteCohort: 0,
    quoteCohortBooked: 0,
    inquiriesAssigned: 0,
    chargesTaken: 0,
    chargedValue: 0,
    invoicesMarkedPaid: 0,
    reviewNotes: 0,
    outboundEmails: outbound.length,
    hqActions,
    activeDays: days.size,
    ...resp,
  }

  if (!userId) return base

  if (person.kind === 'SALES') {
    const [quotes, booked, cohort] = await Promise.all([
      prisma.order.count({ where: { agentId: userId, quoteSentAt: { gte: w.from, lt: w.to } } }),
      prisma.order.findMany({
        where: { agentId: userId, bookedAt: { gte: w.from, lt: w.to } },
        select: { bookedTotal: true },
      }),
      // The cohort is quotes SENT in this window — whether they have booked
      // since is asked of the same rows, so the rate answers "of what he
      // quoted then, how much has landed" rather than mixing two periods.
      prisma.order.findMany({
        where: { agentId: userId, quoteSentAt: { gte: w.from, lt: w.to } },
        select: { bookedAt: true },
      }),
    ])
    base.quotesSent = quotes
    base.ordersBooked = booked.length
    base.bookedValue = booked.reduce((t, o) => t + (o.bookedTotal ? Number(o.bookedTotal) : 0), 0)
    base.quoteCohort = cohort.length
    base.quoteCohortBooked = cohort.filter((o) => o.bookedAt !== null).length
    base.inquiriesAssigned = await prisma.inquiry.count({
      where: { assignedToId: userId, createdAt: { gte: w.from, lt: w.to } },
    })
  } else {
    const [charges, paidMarks, notes] = await Promise.all([
      prisma.rwCollectionCharge.findMany({
        where: { chargedById: userId, chargedAt: { gte: w.from, lt: w.to }, status: 'APPROVED' },
        select: { amount: true },
      }),
      prisma.rwInvoicePaidMark.count({
        where: { markedById: userId, markedAt: { gte: w.from, lt: w.to } },
      }),
      prisma.rwInvoiceReview.count({
        where: { noteBy: person.email, noteAt: { gte: w.from, lt: w.to } },
      }),
    ])
    base.chargesTaken = charges.length
    base.chargedValue = charges.reduce((t, c) => t + Number(c.amount), 0)
    base.invoicesMarkedPaid = paidMarks
    base.reviewNotes = notes
  }

  return base
}

function stat(
  key: string,
  label: string,
  now: number | null,
  prior: number | null,
  unit: Unit,
  betterHigher: boolean | null,
  hint?: string,
): Stat {
  return { key, label, value: now, prior, unit, betterHigher, hint }
}

function buildReport(person: WatchedPerson, hasUser: boolean, cur: Raw, prev: Raw): PersonReport {
  const rate = (n: number, d: number) => (d === 0 ? null : (n / d) * 100)

  const outcomes: Stat[] =
    person.kind === 'SALES'
      ? [
          stat('quotesSent', 'Quotes sent', cur.quotesSent, prev.quotesSent, 'count', true),
          stat('ordersBooked', 'Orders booked', cur.ordersBooked, prev.ordersBooked, 'count', true),
          stat('bookedValue', 'Booked value', cur.bookedValue, prev.bookedValue, 'usd', true),
          stat(
            'winRate',
            'Quotes booked so far',
            rate(cur.quoteCohortBooked, cur.quoteCohort),
            rate(prev.quoteCohortBooked, prev.quoteCohort),
            'pct',
            true,
            'Of the quotes he sent in this window, the share booked as of now. Recent windows read low because their quotes have had less time to land.',
          ),
          stat('inquiriesAssigned', 'Leads assigned', cur.inquiriesAssigned, prev.inquiriesAssigned, 'count', null,
            'Workload in, not output — more leads is not better performance.'),
        ]
      : [
          stat('chargedValue', 'Collected on card', cur.chargedValue, prev.chargedValue, 'usd', true,
            'Approved CardPointe charges she ran. Wires, checks and ACH settled outside HQ are not counted.'),
          stat('chargesTaken', 'Charges run', cur.chargesTaken, prev.chargesTaken, 'count', true),
          stat('invoicesMarkedPaid', 'Invoices cleared', cur.invoicesMarkedPaid, prev.invoicesMarkedPaid, 'count', true),
          stat('reviewNotes', 'Invoices worked', cur.reviewNotes, prev.reviewNotes, 'count', true,
            'Notes she left on the aging review desk — the visible trace of chasing an invoice.'),
        ]

  const effort: Stat[] = [
    stat('outboundEmails', 'Emails sent', cur.outboundEmails, prev.outboundEmails, 'count', null,
      'Auto-replies excluded. Shared inboxes are not attributed, so this is a floor.'),
    stat('hqActions', 'Actions in HQ', cur.hqActions, prev.hqActions, 'count', null,
      'Audited writes only. Reading, searching and most page views leave no record.'),
    stat('activeDays', 'Days active', cur.activeDays, prev.activeDays, 'count', null,
      'Days with any sent mail or logged HQ action. A presence signal, not hours worked.'),
  ]

  const responsivenessStats: Stat[] = [
    stat('medianReplyHours', 'Median time to reply', cur.medianReplyHours, prev.medianReplyHours, 'hours', false,
      'First inbound on a thread to their first reply, measured per thread.'),
    stat('answerRate', 'Threads answered',
      rate(cur.threadsAnswered, cur.threadsReceived),
      rate(prev.threadsAnswered, prev.threadsReceived),
      'pct', true),
    stat('leftUnanswered', 'Still unanswered', cur.leftUnanswered, prev.leftUnanswered, 'count', false,
      `Threads with no reply after ${UNANSWERED_AFTER_HOURS}h. Many are legitimately closed elsewhere — by phone, or by a teammate.`),
    stat('threadsReceived', 'Threads received', cur.threadsReceived, prev.threadsReceived, 'count', null),
  ]

  return {
    email: person.email,
    name: person.name,
    kind: person.kind,
    caveat: person.caveat,
    hasUser,
    outcomes,
    effort,
    responsiveness: responsivenessStats,
  }
}

/**
 * Build every watched person's report for a window, each against their own
 * immediately preceding window of the same length.
 */
export async function teamReports(days: number): Promise<{ reports: PersonReport[]; window: { from: string; to: string; days: number } }> {
  const to = new Date()
  const from = new Date(to.getTime() - days * 86400000)
  const prevFrom = new Date(from.getTime() - days * 86400000)

  const users = await prisma.user.findMany({
    where: { email: { in: WATCHED_PEOPLE.map((p) => p.email) } },
    select: { id: true, email: true },
  })
  const idByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]))

  const reports: PersonReport[] = []
  for (const person of WATCHED_PEOPLE) {
    const userId = idByEmail.get(person.email) ?? null
    const [cur, prev] = await Promise.all([
      rawFor(person, userId, { from, to }),
      rawFor(person, userId, { from: prevFrom, to: from }),
    ])
    reports.push(buildReport(person, userId !== null, cur, prev))
  }

  return {
    reports,
    window: { from: from.toISOString(), to: to.toISOString(), days },
  }
}
