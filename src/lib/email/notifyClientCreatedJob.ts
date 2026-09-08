/**
 * "A client just set up their own job" — the email the desk gets.
 *
 * Wes 2026-09-08: "Where does a client created order get flagged for our
 * team? Let's create an hq@ notification email to go out at 7a on the next
 * business day if the order was submitted overnight and a real time email
 * if during biz hours."
 *
 * Until now a self-serve job raised an action item, a chip on the job page
 * and a line in the twice-daily brief — all surfaces someone has to open.
 * Nothing pushed. Chaotic Neutral LTD signed a rental agreement for a
 * rental five days out and sat unclaimed (see clientCreatedJobs.ts). This
 * is the push.
 *
 * ── When it sends ───────────────────────────────────────────────────────
 * Inside business hours, at once. Outside them, not at all — the row is
 * left unstamped and the 7am cron picks it up on the next business day.
 * The ABSENCE of `AgreementEntry.teamNotifiedAt` is the queue, so there is
 * no scheduled-send table to keep honest and a missed cron run catches up
 * on the following pass rather than dropping the notice.
 *
 * Business hours mirror the published lot hours (yardHours.ts): weekdays
 * 6am–6pm, Saturday 7am–3:30pm, closed Sunday, Pacific. A Saturday
 * afternoon submission therefore waits until Monday 7am, which is the
 * point — nobody is reading it on Sunday.
 */
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from '@/lib/email/templates/shell'
import { describeClientCreatedJob, listClientCreatedUnquoted, type ClientCreatedJob } from '@/lib/sales/clientCreatedJobs'

const TZ = 'America/Los_Angeles'
const HQ_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

/** Minutes past midnight, Pacific, plus the weekday. */
function pacificParts(d: Date): { minutes: number; weekday: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
  const parts = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts.weekday))
  // 24:00 is midnight at the START of the day in some ICU builds.
  const hour = Number(parts.hour) % 24
  return { minutes: hour * 60 + Number(parts.minute), weekday }
}

/** Open hours in minutes past midnight, by weekday. Null = closed. */
const OPEN: Array<[number, number] | null> = [
  null, // Sun — closed
  [6 * 60, 18 * 60], // Mon
  [6 * 60, 18 * 60],
  [6 * 60, 18 * 60],
  [6 * 60, 18 * 60],
  [6 * 60, 18 * 60], // Fri
  [7 * 60, 15 * 60 + 30], // Sat
]

/** True when SirReel is open right now — someone is there to read it. */
export function inBusinessHours(now: Date = new Date()): boolean {
  const { minutes, weekday } = pacificParts(now)
  const window = OPEN[weekday]
  return !!window && minutes >= window[0] && minutes < window[1]
}

function fmtDay(iso: string | null): string {
  if (!iso) return 'not given'
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${iso}T12:00:00Z`))
}

function buildEmail(job: ClientCreatedJob, opts: { overnight: boolean }) {
  const jobUrl = `${HQ_APP_URL}/jobs/${job.jobId}`
  const subject = `Client set up their own job — ${job.jobName} (${job.jobCode})`
  const dates = job.start
    ? job.end && job.end !== job.start
      ? `${fmtDay(job.start)} – ${fmtDay(job.end)}`
      : fmtDay(job.start)
    : 'no dates given'
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Job', value: `${job.jobName} · ${job.jobCode}` },
    { label: 'Order', value: job.orderNumber },
    { label: 'Company', value: job.companyName ?? 'not given' },
    { label: 'Dates', value: dates },
    { label: 'Lines', value: job.lineCount === 0 ? 'nothing on it' : `${job.lineCount} line${job.lineCount === 1 ? '' : 's'}, unpriced` },
    { label: 'Agreement', value: job.agreementSigned ? 'Signed by the client' : 'Not signed' },
    { label: 'Owner', value: job.agentName ?? 'nobody yet' },
    { label: 'Created', value: new Intl.DateTimeFormat('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(job.createdAt) },
  ]

  // One line that reads like a person wrote it, from the same describer the
  // action item and the brief use — so all three tell the same story.
  const summary = describeClientCreatedJob(job)
  const lead = opts.overnight
    ? 'A client set up their own job while we were closed. Nobody has quoted it.'
    : 'A client just set up their own job on the website. Nobody has quoted it yet.'

  const html = renderEmailShell({
    eyebrow: 'Client-created job',
    heading: job.jobName,
    preheader: `${job.jobCode} · ${job.companyName ?? 'no company'} · ${summary}`,
    bodyHtml: [
      p(lead),
      detailTable(rows),
      calloutBox(
        job.agreementSigned
          ? 'They have <strong>signed the rental agreement</strong> against an order with no pricing on it. Quote it before they read something into the silence.'
          : 'The order is a draft with no pricing on it. It needs an owner and a quote.',
      ),
      p('The job page has a <strong>Next-steps email</strong> button that composes a reply for you to review before it sends.'),
    ].join('\n'),
    cta: { label: 'Open the job', href: jobUrl },
    footNote: 'You are getting this because a client created a job without an agent. Change who receives it at /admin/notifications.',
  })

  const text = renderEmailText([
    lead,
    '',
    ...rows.map((r) => `${r.label}: ${r.value}`),
    '',
    summary,
    '',
    `Open the job: ${jobUrl}`,
  ])

  return { subject, html, text }
}

export interface NotifyOutcome {
  jobId: string
  jobCode: string
  sent: boolean
  deferred: boolean
  reason?: string
}

/**
 * Tell the desk about one client-created job, once.
 *
 * `force` is the cron's flag: it has already decided the time is right, so
 * it does not re-check business hours (7am is before the yard opens on a
 * Saturday, and the whole point is that Monday 7am catches the weekend).
 */
export async function notifyClientCreatedJob(args: {
  entryId: string
  /** Already in hand (the sweep has it); otherwise it is looked up. */
  job?: ClientCreatedJob
  force?: boolean
  now?: Date
}): Promise<NotifyOutcome> {
  const now = args.now ?? new Date()

  const entry = await prisma.agreementEntry.findUnique({ where: { id: args.entryId }, select: { teamNotifiedAt: true } })
  if (!entry) return { jobId: '', jobCode: '', sent: false, deferred: false, reason: 'no agreement entry' }
  if (entry.teamNotifiedAt) return { jobId: '', jobCode: '', sent: false, deferred: false, reason: 'already notified' }

  // Same query every other client-created surface reads, so the email, the
  // action item and the brief cannot describe the job differently.
  const job = args.job ?? (await listClientCreatedUnquoted({ includeStale: true })).find((j) => j.entryId === args.entryId)
  if (!job) return { jobId: '', jobCode: '', sent: false, deferred: false, reason: 'no unquoted client-created job for this entry' }
  const base = { jobId: job.jobId, jobCode: job.jobCode }

  if (!args.force && !inBusinessHours(now)) {
    // Deliberately no stamp: the empty column IS the queue.
    return { ...base, sent: false, deferred: true, reason: 'outside business hours — the 7am sweep will send it' }
  }

  const to = await channelRecipients('client-created-jobs')
  if (to.length === 0) return { ...base, sent: false, deferred: false, reason: 'nobody is on the client-created-jobs channel' }

  const mail = buildEmail(job, { overnight: !!args.force })
  const res = await sendAgreementEmail({
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    label: 'client-created-job',
    orderId: job.orderId,
  })
  if (!res.ok) return { ...base, sent: false, deferred: false, reason: res.reason }

  await prisma.agreementEntry.update({ where: { id: args.entryId }, data: { teamNotifiedAt: new Date() } })
  return { ...base, sent: true, deferred: false }
}

/**
 * The 7am sweep. Every client-created job the desk has not been told about
 * — which after an overnight run means everything that came in since the
 * lot closed — goes out now.
 */
export async function sweepClientCreatedNotices(now: Date = new Date()): Promise<{ considered: number; sent: number; outcomes: NotifyOutcome[] }> {
  // Default scope on purpose: `includeStale` rows are jobs whose rental
  // window has already passed. A dead lead is a post-mortem, not a 7am
  // push — the same call the action item and the brief make.
  const jobs = await listClientCreatedUnquoted()
  const outcomes: NotifyOutcome[] = []
  for (const job of jobs) {
    if (!job.entryId) continue
    const o = await notifyClientCreatedJob({ entryId: job.entryId, job, force: true, now })
    if (o.reason === 'already notified') continue
    outcomes.push(o)
  }
  return { considered: jobs.length, sent: outcomes.filter((o) => o.sent).length, outcomes }
}

/**
 * What the sweep WOULD send, composed but not sent. Backs `?preview=1` on
 * the cron so the email can be read — by a person or in a test — without
 * putting anything in anyone's inbox.
 */
export async function previewClientCreatedNotices(): Promise<Array<{ jobCode: string; to: string[]; subject: string; html: string; text: string; alreadyNotified: boolean }>> {
  const jobs = await listClientCreatedUnquoted()
  const to = await channelRecipients('client-created-jobs')
  const out = []
  for (const job of jobs) {
    if (!job.entryId) continue
    const entry = await prisma.agreementEntry.findUnique({ where: { id: job.entryId }, select: { teamNotifiedAt: true } })
    const mail = buildEmail(job, { overnight: true })
    out.push({ jobCode: job.jobCode, to, subject: mail.subject, html: mail.html, text: mail.text, alreadyNotified: !!entry?.teamNotifiedAt })
  }
  return out
}
