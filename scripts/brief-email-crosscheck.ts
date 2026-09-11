#!/usr/bin/env tsx
/**
 * Cross-check the jobs in a "Today at SirReel" brief against the client
 * email that came in around it.
 *
 * Wes, 2026-09-11: "Search specifically the jobs referenced in the today at
 * SirReel email that went out and see if the client interactions via email
 * in the past day or two affect any of them."
 *
 * The email watch already CLASSIFIES a cancellation ("Project got cancelled"
 * is EXPLICIT_REJECTION in src/lib/email/replyClassifier.ts) but never acts
 * on a booked job — the cadence bridge needs EmailMessage.companyId, which
 * nothing at ingest writes, and it only ever touches open quotes. So a
 * client can cancel by email and the job stays on the morning brief. This
 * script is the manual pass that closes that gap: rebuild the brief's job
 * list, pull every email that touches those jobs, and flag the ones that
 * read like a change of plan.
 *
 * READ-ONLY. Writes nothing.
 *
 * ── How an email is tied to a job ──────────────────────────────────
 * There is no EmailMessage → Job foreign key. Four signals, all reported
 * so the reader can see WHY a message was attached:
 *   thread     EmailThread.jobId (set by Quick Reply / inquiry conversion)
 *   contact    From/To matches a JobContact person's email
 *   domain     sender's domain matches the production company's website
 *              domain (freemail / internal / vendor domains skipped, same
 *              rule as CRM capture)
 *   subject    subject names the job or one of its order numbers
 *
 * ── What "affects" means ───────────────────────────────────────────
 * A message is flagged when any of:
 *   - the reply classifier said EXPLICIT_REJECTION (any confidence — a low
 *     confidence rejection is still worth a human's eyes here)
 *   - the extractor's messageNature is "rejection"
 *   - the body/subject carries change-of-plan vocabulary: cancel, postpone,
 *     push, reschedule, pull out, no longer need, on hold, date change, …
 * Everything else that matched is listed as routine so the picture is
 * complete ("they wrote, it was just a COI") rather than only the alarms.
 *
 * Usage:
 *   npx tsx scripts/brief-email-crosscheck.ts                 # this morning's brief, last 2 days of mail
 *   npx tsx scripts/brief-email-crosscheck.ts --edition evening
 *   npx tsx scripts/brief-email-crosscheck.ts --days 3
 *   npx tsx scripts/brief-email-crosscheck.ts --as-of 2026-09-11T13:00:00Z  # rebuild the brief as it stood then
 *   npx tsx scripts/brief-email-crosscheck.ts --json          # machine-readable
 *
 * Needs DATABASE_URL (see CLAUDE.md) — or .env.prod.local via _loadProdEnv.
 */

import './_loadProdEnv'
import { prisma } from '@/lib/prisma'
import { buildDailyBrief, type BriefEdition } from '@/lib/email/dailyBrief'
import { domainOf, isMatchableDomain } from '@/lib/crm/domainCompanyMatch'

// ── args ─────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const edition: BriefEdition = arg('edition') === 'evening' ? 'evening' : 'morning'
const days = Math.max(1, Number(arg('days') ?? 2))
const asOf = arg('as-of') ? new Date(arg('as-of')!) : new Date()
const asJson = flag('json')

if (Number.isNaN(asOf.getTime())) {
  console.error('--as-of must be an ISO timestamp')
  process.exit(1)
}

// ── change-of-plan vocabulary ───────────────────────────────────────
// Deliberately broad; the output tells you which phrase hit so a false
// positive costs one glance. "push" alone is too common ("push the quote
// through"), so it is bound to dates.
const CHANGE_RE =
  /\b(cancel(?:l?ed|l?ing|lation)?|postpon(?:e|ed|ing)|resched(?:ule|uled|uling)|push(?:ed|ing)? (?:the |our )?(?:dates?|shoot|pickup|pick-up|start|job|rental)|pull(?:ing|ed)? out|no longer (?:need|require|going)|not (?:going to|gonna) need|on hold|put (?:it |this |the job )?on hold|date change|change (?:of|the|our) dates?|mov(?:e|ed|ing) (?:the |our )?(?:dates?|shoot|pickup|pick-up)|shoot (?:got |was |has been |is )?(?:cancel|postpon|pushed|moved)|scrap(?:ped)?|call(?:ed)? off|fell through|didn'?t get (?:the )?(?:job|green ?light)|not moving forward|won'?t be (?:moving forward|needing)|extend(?:ed|ing)? (?:the |our )?(?:rental|dates?|return)|return(?:ing)? (?:it |them |the (?:truck|van|cube|trailer) )?early|keep (?:it|them|the (?:truck|van|cube|trailer)) (?:an extra|another|longer)|add(?:ing)? (?:a |another |one more )?(?:day|week))\b/i

// Extraction JSON shape — only the field this script reads.
type Extracted = { messageNature?: string; summary?: string } | null

interface Hit {
  messageId: string
  threadId: string | null
  sentAt: Date
  direction: string
  autoReply: boolean
  fromAddress: string
  toAddresses: string[]
  subject: string
  snippet: string
  summary: string | null
  replyClassification: string | null
  replyClassificationConfidence: number | null
  messageNature: string | null
  linkedBy: string[]
  flags: string[]
}

interface JobReport {
  jobId: string
  jobCode: string | null
  jobName: string
  companyName: string | null
  status: string
  orders: string[]
  contactEmails: string[]
  companyDomain: string | null
  hits: Hit[]
  verdict: 'no-email' | 'routine' | 'CHECK'
}

// ── helpers ──────────────────────────────────────────────────────────

function bareAddress(a: string): string {
  const m = a.match(/<([^>]+)>/)
  return (m ? m[1] : a).trim().toLowerCase()
}

function websiteDomain(website: string | null | undefined): string | null {
  if (!website) return null
  const d = website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
  return d && isMatchableDomain(d) ? d : null
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function fmt(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ── main ─────────────────────────────────────────────────────────────

async function main() {
  // 1. The brief, rebuilt as of the given moment. Job ids are parsed out of
  //    the rendered HTML so every section counts (Going out, Coming back,
  //    Later this week, Still out, Clients waiting) — exactly the links a
  //    reader of the email could have clicked.
  const brief = await buildDailyBrief(edition, asOf)
  const jobIds = Array.from(new Set(Array.from(brief.html.matchAll(/\/jobs\/([0-9a-f-]{36})/g)).map((m) => m[1])))
  const orderIdsWithoutJob = Array.from(
    new Set(Array.from(brief.html.matchAll(/\/orders\/([0-9a-f-]{36})/g)).map((m) => m[1])),
  )

  const since = new Date(asOf.getTime() - days * 86_400_000)

  const jobs = await prisma.job.findMany({
    where: { id: { in: jobIds } },
    select: {
      id: true,
      jobCode: true,
      name: true,
      status: true,
      company: { select: { name: true, website: true, billingEmail: true } },
      orders: { select: { id: true, orderNumber: true, status: true } },
      jobContacts: { select: { person: { select: { email: true } } } },
    },
  })
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  // Orders the brief linked directly (no job) — attach to their job anyway
  // so nothing the email named is skipped.
  const orphanOrders = await prisma.order.findMany({
    where: { id: { in: orderIdsWithoutJob }, jobId: { notIn: jobIds } },
    select: { jobId: true },
  })
  const extraJobIds = orphanOrders.map((o) => o.jobId).filter((id) => !jobById.has(id))
  if (extraJobIds.length) {
    const extra = await prisma.job.findMany({
      where: { id: { in: extraJobIds } },
      select: {
        id: true,
        jobCode: true,
        name: true,
        status: true,
        company: { select: { name: true, website: true, billingEmail: true } },
        orders: { select: { id: true, orderNumber: true, status: true } },
        jobContacts: { select: { person: { select: { email: true } } } },
      },
    })
    for (const j of extra) jobById.set(j.id, j)
  }

  // 2. Every non-duplicate message in the window, once. Cheaper than one
  //    query per job and lets the same message attach to two jobs from the
  //    same company (which is itself worth seeing).
  const messages = await prisma.emailMessage.findMany({
    where: { sentAt: { gte: since, lte: asOf }, duplicateOfId: null },
    select: {
      id: true,
      threadId: true,
      sentAt: true,
      direction: true,
      autoReply: true,
      fromAddress: true,
      toAddresses: true,
      subject: true,
      snippet: true,
      bodyText: true,
      replySummary: true,
      replyClassification: true,
      replyClassificationConfidence: true,
      extractedData: true,
      thread: { select: { jobId: true } },
    },
    orderBy: { sentAt: 'asc' },
  })

  // 3. Attach + flag.
  const reports: JobReport[] = []
  for (const job of jobById.values()) {
    const contactEmails = Array.from(
      new Set(
        [...job.jobContacts.map((c) => c.person.email?.toLowerCase()), job.company?.billingEmail?.toLowerCase()].filter(
          (e): e is string => !!e,
        ),
      ),
    )
    const companyDomain = websiteDomain(job.company?.website)
    const orderNumbers = job.orders.map((o) => o.orderNumber)
    const nameRe = job.name.trim().length >= 6 ? new RegExp(esc(job.name.trim()), 'i') : null
    const orderRe = orderNumbers.length ? new RegExp(orderNumbers.map(esc).join('|'), 'i') : null

    const hits: Hit[] = []
    for (const m of messages) {
      const from = bareAddress(m.fromAddress)
      const parties = [from, ...m.toAddresses.map(bareAddress)]
      const linkedBy: string[] = []
      if (m.thread?.jobId === job.id) linkedBy.push('thread')
      if (parties.some((p) => contactEmails.includes(p))) linkedBy.push('contact')
      if (companyDomain && parties.some((p) => domainOf(p) === companyDomain)) linkedBy.push('domain')
      if ((nameRe && nameRe.test(m.subject)) || (orderRe && orderRe.test(m.subject))) linkedBy.push('subject')
      if (linkedBy.length === 0) continue

      const extracted = (m.extractedData ?? null) as Extracted
      const nature = extracted?.messageNature ?? null
      const flags: string[] = []
      if (m.replyClassification === 'EXPLICIT_REJECTION') {
        flags.push(`classifier: EXPLICIT_REJECTION @ ${(m.replyClassificationConfidence ?? 0).toFixed(2)}`)
      }
      if (nature === 'rejection') flags.push('extractor: rejection')
      const text = `${m.subject}\n${m.bodyText ?? m.snippet ?? ''}`
      const phrase = text.match(CHANGE_RE)
      if (phrase) flags.push(`says "${phrase[0]}"`)
      // Change-of-plan words in OUR outbound matter too (a rep confirming
      // "cancelled as requested" is the strongest signal of all), but an
      // autoresponder never does.
      if (m.autoReply) flags.length = 0

      hits.push({
        messageId: m.id,
        threadId: m.threadId,
        sentAt: m.sentAt,
        direction: m.direction,
        autoReply: m.autoReply,
        fromAddress: from,
        toAddresses: m.toAddresses.map(bareAddress),
        subject: m.subject,
        snippet: (m.snippet ?? '').slice(0, 160),
        summary: m.replySummary ?? extracted?.summary ?? null,
        replyClassification: m.replyClassification,
        replyClassificationConfidence: m.replyClassificationConfidence,
        messageNature: nature,
        linkedBy,
        flags,
      })
    }

    reports.push({
      jobId: job.id,
      jobCode: job.jobCode,
      jobName: job.name,
      companyName: job.company?.name ?? null,
      status: job.status,
      orders: orderNumbers,
      contactEmails,
      companyDomain,
      hits,
      verdict: hits.length === 0 ? 'no-email' : hits.some((h) => h.flags.length) ? 'CHECK' : 'routine',
    })
  }

  const order = { CHECK: 0, routine: 1, 'no-email': 2 } as const
  reports.sort((a, b) => order[a.verdict] - order[b.verdict] || a.jobName.localeCompare(b.jobName))

  if (asJson) {
    console.log(
      JSON.stringify(
        { edition, asOf: asOf.toISOString(), since: since.toISOString(), subject: brief.subject, reports },
        null,
        2,
      ),
    )
    return
  }

  // 4. Print.
  console.log(`Brief: ${brief.subject}`)
  console.log(`Rebuilt as of ${asOf.toISOString()} — ${reports.length} jobs referenced`)
  console.log(`Email window: ${since.toISOString()} → ${asOf.toISOString()} (${messages.length} messages scanned)\n`)

  const counts = { CHECK: 0, routine: 0, 'no-email': 0 }
  for (const r of reports) counts[r.verdict]++
  console.log(`  CHECK    ${counts.CHECK}   jobs with email that reads like a change of plan`)
  console.log(`  routine  ${counts.routine}   jobs with email, nothing alarming`)
  console.log(`  no email ${counts['no-email']}   jobs with no client email in the window\n`)

  for (const r of reports) {
    if (r.verdict === 'no-email') continue
    const head = `${r.verdict === 'CHECK' ? '⚠ CHECK ' : '  ok    '} ${r.jobName}${r.companyName ? ` · ${r.companyName}` : ''}`
    console.log(head)
    console.log(
      `         ${r.jobCode ?? ''} ${r.orders.join(', ')} · job ${r.status} · https://hq.sirreel.com/jobs/${r.jobId}`,
    )
    for (const h of r.hits) {
      const dir = h.direction === 'inbound' ? '←' : '→'
      const who = h.direction === 'inbound' ? h.fromAddress : h.toAddresses.join(', ')
      console.log(`         ${fmt(h.sentAt)} ${dir} ${who}${h.autoReply ? ' (auto-reply)' : ''}`)
      console.log(`           "${h.subject}"   [${h.linkedBy.join(', ')}]`)
      if (h.summary) console.log(`           ${h.summary}`)
      else if (h.snippet) console.log(`           ${h.snippet}`)
      const cls = h.replyClassification
        ? `${h.replyClassification} @ ${(h.replyClassificationConfidence ?? 0).toFixed(2)}`
        : null
      const meta = [cls, h.messageNature ? `nature=${h.messageNature}` : null].filter(Boolean).join(' · ')
      if (meta) console.log(`           ${meta}`)
      for (const f of h.flags) console.log(`           ⚠ ${f}`)
    }
    console.log('')
  }

  const quiet = reports.filter((r) => r.verdict === 'no-email')
  if (quiet.length) {
    console.log('No client email in the window:')
    for (const r of quiet) {
      const why =
        r.contactEmails.length === 0 && !r.companyDomain
          ? '  (no contact email or company domain on file — could only match by thread/subject)'
          : ''
      console.log(`  - ${r.jobName}${r.companyName ? ` · ${r.companyName}` : ''}${why}`)
    }
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
