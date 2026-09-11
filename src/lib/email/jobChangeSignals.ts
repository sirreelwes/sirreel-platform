/**
 * Job email signals — a client email that READS like a change of plan on
 * a live job becomes a SUGGESTION on that job, never a change to it.
 *
 * Wes 2026-09-11: "Because there can be nuance in a client's cancelling
 * or changing of a job we want to make sure that any changes to HQ are
 * gated with a confirmation or suggestion."
 *
 * So this module does exactly two things:
 *   1. `classifyChangeSignal` — pure. Reads the words (plus the reply
 *      classifier's verdict and the extractor's messageNature, when they
 *      exist) and says which KIND of change the message sounds like, with
 *      the evidence quoted. It does not decide whether the change is real.
 *   2. `detectJobChangeSignals` — ties an inbound message to the live jobs
 *      it could be about and writes one OPEN JobEmailSignal per job. The
 *      job, its orders, its holds, its bookings: untouched. A person
 *      confirms on the job page (and makes the change through the
 *      existing controls — Mark lost, order dates, status menu) or
 *      dismisses it.
 *
 * Why not act on a high-confidence EXPLICIT_REJECTION? "Project got
 * cancelled" from the PC can mean the whole show, one of three orders,
 * or the Tuesday pickup only; "cancel the cube" is not "cancel the job".
 * The words are the same, the right HQ change is not. A suggestion with
 * the sentence quoted costs the rep one glance; a wrong auto-cancel costs
 * a released truck.
 *
 * Linking (there is no EmailMessage → Job key), each reported so the
 * reader sees WHY the job was named:
 *   thread   EmailThread.jobId (Quick Reply / inquiry conversion set it)
 *   contact  From / To is a JobContact person on the job (or the company's
 *            billing address)
 *   domain   the sender's domain is the production company's website
 *            domain (freemail / internal / vendor domains never match)
 *   subject  the subject carries one of the job's order numbers or its
 *            job code
 * Only LIVE jobs qualify: not archived, not already LOST / WRAPPED, with
 * at least one order outside CANCELLED / CLOSED. A cancellation on a job
 * that is already off the board is not news.
 *
 * Fail-soft: the table is a 2026-09-11 addition (`npx prisma db push`);
 * until it exists every write here is caught and logged, and nothing
 * upstream (pubsub, extraction) notices.
 */

import type { JobEmailSignalKind, Prisma, ReplyClassification } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { domainOf, isMatchableDomain } from '@/lib/crm/domainCompanyMatch'

// ── 1. Pure classification ───────────────────────────────────────────

export interface ChangeSignalInput {
  subject: string
  bodyText: string | null | undefined
  /** Reply classifier verdict, when the message was a reply on a quote thread. */
  replyClassification?: ReplyClassification | null
  /** Extractor's messageNature, when extraction has run. */
  messageNature?: string | null
}

export interface ChangeSignal {
  kind: JobEmailSignalKind
  /** Human-readable reasons, each one sentence, phrase quoted verbatim. */
  evidence: string[]
}

/**
 * Vocabulary, most specific first. Each pattern is bound to the object it
 * changes where a bare verb would be noise: "push" alone is "push the
 * quote through", "move" alone is "move the truck to bay 2". The matched
 * text is quoted back in the evidence so a false positive costs one glance.
 */
const PATTERNS: ReadonlyArray<{ kind: JobEmailSignalKind; re: RegExp }> = [
  {
    kind: 'RETURN_EARLY',
    re: /\b(return(?:ing)? (?:it |them |everything |the (?:truck|van|cube|trailer|vehicles?|units?) )?(?:a day |two days |\d+ days? )?early|bring(?:ing)? (?:it|them|everything|the (?:truck|van|cube|trailer)) back early|wrap(?:ped|ping)? early|done (?:a day |two days )?early|won'?t need (?:it|them|the (?:truck|van|cube|trailer)) (?:after|past|beyond)|drop(?:ping)? (?:it|them) off early)\b/i,
  },
  {
    kind: 'EXTEND',
    re: /\b(extend(?:ed|ing)? (?:the |our )?(?:rental|dates?|return|booking|reservation|through|to|until|by)|keep (?:it|them|the (?:truck|van|cube|trailer|vehicles?|units?)) (?:an extra|another|one more|a few more|for another|through|until|longer)|add(?:ing)? (?:a |another |one more |two more |\d+ more )?(?:day|days|week|weeks) (?:to|on) (?:the |our )?(?:rental|booking|order|reservation)|(?:need|want)(?:ing)? (?:it|them) (?:a day|two days|\d+ days?|a week) longer|hold(?:ing)? onto (?:it|them|the (?:truck|van|cube|trailer)) (?:until|through|for))\b/i,
  },
  {
    kind: 'DATE_CHANGE',
    re: /\b(push(?:ed|ing)? (?:the |our |back |out )?(?:dates?|shoot|pickup|pick-up|pick up|start|job|rental|booking|delivery)|postpon(?:e|ed|ing)|resched(?:ule|uled|uling)|date change|change (?:of|in|to) (?:the |our )?(?:dates?|schedule)|(?:dates?|schedule) (?:has |have )?changed|mov(?:e|ed|ing) (?:the |our )?(?:dates?|shoot|pickup|pick-up|pick up|start|delivery|booking) (?:to|up|back|out|forward)|shoot (?:got |was |has been |is being |is )?(?:pushed|moved|postponed|rescheduled)|new dates?|(?:pickup|pick-up|delivery) (?:is )?now (?:on )?(?:mon|tues|wednes|thurs|fri|satur|sun)day|bump(?:ed|ing)? (?:the |our )?(?:dates?|shoot|pickup))\b/i,
  },
  {
    kind: 'HOLD',
    re: /\b(on hold|put (?:it |this |the (?:job|shoot|booking|order) )?on hold|pause (?:the |our )?(?:job|booking|order|rental)|holding off (?:on|for now)|hold off (?:on|for now)|tbd (?:on|for) (?:dates|now)|up in the air|waiting on (?:the )?green ?light|not (?:yet )?confirmed (?:yet|on our end))\b/i,
  },
  {
    kind: 'CANCEL',
    re: /\b(cancel(?:l?ed|l?ing|lation|s)?|pull(?:ing|ed)? (?:out|the plug)|no longer (?:need|needs|needed|require|required|going ahead|happening|moving forward)|not (?:going to|gonna) need|won'?t be (?:needing|moving forward|going ahead|proceeding)|not moving forward|scrap(?:ped|ping)?|call(?:ed|ing)? (?:it |the (?:job|shoot) )?off|fell through|falls through|didn'?t get (?:the )?(?:job|green ?light|greenlight|go-ahead)|(?:job|shoot|show|project|production) (?:is |was |got |has been )?(?:dead|killed|axed|shelved|off)|kill(?:ed|ing)? (?:the )?(?:job|shoot|show|project)|release (?:the |our )?(?:hold|holds|units?|trucks?|vehicles?|dates?))\b/i,
  },
]

/**
 * Which change a message sounds like, or null. Never throws. Pure — the
 * cross-check script and the ingest detector share it so the two can't
 * disagree about what counts.
 *
 * Priority: the most specific vocabulary wins (an "extend" is not a
 * "cancel" even though "we're cancelling the Friday return and keeping it
 * through Monday" contains both), then the classifier's EXPLICIT_REJECTION
 * / the extractor's "rejection" as CANCEL when the words alone said
 * nothing.
 */
export function classifyChangeSignal(input: ChangeSignalInput): ChangeSignal | null {
  const text = `${input.subject ?? ''}\n${input.bodyText ?? ''}`
  // Quoted-reply tails repeat the whole thread; only the client's own words
  // should raise a signal. Cut at the first quote marker we recognise.
  const own = text.split(/\n(?:On .{10,120} wrote:|-{3,} ?Original Message ?-{3,}|From: .+\nSent: |>)/)[0]

  const evidence: string[] = []
  let kind: JobEmailSignalKind | null = null
  for (const p of PATTERNS) {
    const m = own.match(p.re)
    if (m) {
      kind = p.kind
      evidence.push(`says "${m[0].trim()}"`)
      break
    }
  }

  if (input.replyClassification === 'EXPLICIT_REJECTION') {
    evidence.push('reply classifier: EXPLICIT_REJECTION')
    kind ??= 'CANCEL'
  }
  if (input.messageNature === 'rejection') {
    evidence.push('extractor: messageNature=rejection')
    kind ??= 'CANCEL'
  }

  return kind ? { kind, evidence } : null
}

export const SIGNAL_KIND_LABEL: Record<JobEmailSignalKind, string> = {
  CANCEL: 'may be cancelling',
  HOLD: 'may be putting it on hold',
  DATE_CHANGE: 'may be moving the dates',
  EXTEND: 'may be extending',
  RETURN_EARLY: 'may be returning early',
}

// ── 2. Linking a message to live jobs ────────────────────────────────

const ORDER_OR_JOB_CODE_RE = /\b(S\d{6}-\d{3}|SR-ORD-\d{3,}|SR-JOB-\d{3,})\b/gi

function bareAddress(a: string): string {
  const m = a.match(/<([^>]+)>/)
  return (m ? m[1] : a).trim().toLowerCase()
}

export function websiteDomain(website: string | null | undefined): string | null {
  if (!website) return null
  const d = website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
  return d && isMatchableDomain(d) ? d : null
}

/** A job is live when it can still be changed by what a client says. */
const LIVE_JOB_WHERE: Prisma.JobWhereInput = {
  archivedAt: null,
  status: { notIn: ['LOST', 'WRAPPED'] },
  orders: { some: { status: { notIn: ['CANCELLED', 'CLOSED'] } } },
}

export interface LinkedJob {
  jobId: string
  linkedBy: string[]
}

/**
 * Every live job this message could be about, with the reasons. Cheap:
 * one query per signal type, each keyed on an index, none scanning bodies.
 */
export async function linkMessageToLiveJobs(msg: {
  threadJobId: string | null
  fromAddress: string
  toAddresses: string[]
  subject: string
}): Promise<LinkedJob[]> {
  const parties = Array.from(new Set([msg.fromAddress, ...msg.toAddresses].map(bareAddress).filter(Boolean)))
  const domains = Array.from(new Set(parties.map(domainOf).filter((d) => d && isMatchableDomain(d))))
  const codes = Array.from(new Set(Array.from(msg.subject.matchAll(ORDER_OR_JOB_CODE_RE)).map((m) => m[1].toUpperCase())))

  const found = new Map<string, Set<string>>()
  const add = (id: string, why: string) => {
    if (!found.has(id)) found.set(id, new Set())
    found.get(id)!.add(why)
  }

  if (msg.threadJobId) {
    const j = await prisma.job.findFirst({ where: { id: msg.threadJobId, ...LIVE_JOB_WHERE }, select: { id: true } })
    if (j) add(j.id, 'thread')
  }

  if (parties.length) {
    const byContact = await prisma.job.findMany({
      where: {
        ...LIVE_JOB_WHERE,
        OR: [
          { jobContacts: { some: { person: { email: { in: parties, mode: 'insensitive' } } } } },
          { company: { billingEmail: { in: parties, mode: 'insensitive' } } },
        ],
      },
      select: { id: true },
      take: 20,
    })
    for (const j of byContact) add(j.id, 'contact')
  }

  if (domains.length) {
    // Company.website is free text ("https://www.figs.com/") — match on
    // the domain being contained, then verify with websiteDomain() so
    // "figs.com" cannot match "bigfigs.com".
    const byDomain = await prisma.job.findMany({
      where: {
        ...LIVE_JOB_WHERE,
        company: { OR: domains.map((d) => ({ website: { contains: d, mode: 'insensitive' as const } })) },
      },
      select: { id: true, company: { select: { website: true } } },
      take: 20,
    })
    for (const j of byDomain) {
      const wd = websiteDomain(j.company?.website)
      if (wd && domains.includes(wd)) add(j.id, 'domain')
    }
  }

  if (codes.length) {
    const byCode = await prisma.job.findMany({
      where: {
        ...LIVE_JOB_WHERE,
        OR: [{ jobCode: { in: codes } }, { orders: { some: { orderNumber: { in: codes } } } }],
      },
      select: { id: true },
      take: 20,
    })
    for (const j of byCode) add(j.id, 'subject')
  }

  return Array.from(found.entries()).map(([jobId, why]) => ({ jobId, linkedBy: Array.from(why) }))
}

// ── 3. The detector ──────────────────────────────────────────────────

export interface DetectResult {
  signal: ChangeSignal | null
  /** Jobs that received a new OPEN row this call. */
  created: string[]
  /** Jobs linked but already carrying a row for this message. */
  existing: string[]
  skipped?: string
}

/**
 * Run after a message is stored (and again after extraction, which may add
 * the messageNature). Idempotent per (job, message). Reads the message
 * fresh so both call sites see the same fields.
 */
export async function detectJobChangeSignals(emailMessageId: string): Promise<DetectResult> {
  const none = (skipped: string): DetectResult => ({ signal: null, created: [], existing: [], skipped })

  const msg = await prisma.emailMessage
    .findUnique({
      where: { id: emailMessageId },
      select: {
        id: true,
        direction: true,
        autoReply: true,
        duplicateOfId: true,
        fromAddress: true,
        toAddresses: true,
        subject: true,
        bodyText: true,
        snippet: true,
        replyClassification: true,
        replySummary: true,
        extractedData: true,
        thread: { select: { jobId: true } },
      },
    })
    .catch(() => null)
  if (!msg) return none('no-message')
  if (msg.direction !== 'inbound') return none('outbound')
  if (msg.autoReply) return none('auto-reply')
  if (msg.duplicateOfId) return none('duplicate')

  const extracted = (msg.extractedData ?? null) as { messageNature?: string; summary?: string } | null
  const signal = classifyChangeSignal({
    subject: msg.subject,
    bodyText: msg.bodyText ?? msg.snippet,
    replyClassification: msg.replyClassification,
    messageNature: extracted?.messageNature ?? null,
  })
  if (!signal) return { signal: null, created: [], existing: [] }

  const jobs = await linkMessageToLiveJobs({
    threadJobId: msg.thread?.jobId ?? null,
    fromAddress: msg.fromAddress,
    toAddresses: msg.toAddresses,
    subject: msg.subject,
  })
  if (jobs.length === 0) return { signal, created: [], existing: [], skipped: 'no-live-job' }

  const created: string[] = []
  const existing: string[] = []
  for (const j of jobs) {
    try {
      const row = await prisma.jobEmailSignal.upsert({
        where: { jobId_emailMessageId: { jobId: j.jobId, emailMessageId: msg.id } },
        // A second pass (extraction after classification) may know more:
        // refresh the evidence + summary on an OPEN row, never its status.
        update: { evidence: signal.evidence, linkedBy: j.linkedBy, summary: msg.replySummary ?? extracted?.summary ?? null },
        create: {
          jobId: j.jobId,
          emailMessageId: msg.id,
          kind: signal.kind,
          evidence: signal.evidence,
          linkedBy: j.linkedBy,
          summary: msg.replySummary ?? extracted?.summary ?? null,
        },
        select: { createdAt: true },
      })
      // upsert can't tell us which branch ran; a row younger than 5s is ours.
      ;(Date.now() - row.createdAt.getTime() < 5000 ? created : existing).push(j.jobId)
    } catch (err) {
      // Table not pushed yet, or a race on the unique key — never the
      // caller's problem.
      console.warn('[job-change-signals] write failed:', j.jobId, err instanceof Error ? err.message : err)
    }
  }
  return { signal, created, existing }
}
