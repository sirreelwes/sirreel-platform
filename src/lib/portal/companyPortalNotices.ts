/**
 * The account portal's outbound notices — detection and sending.
 *
 * Wes 2026-09-04: "an option for what notifications they would like: Job
 * Start, Invoices Paid and job closed, etc."
 *
 * ── A sweep, not twenty write-path hooks ───────────────────────────────
 * "An invoice was paid" can happen through a portal card payment, a portal
 * ACH settlement, a staff-recorded check, the ACH poller, or a RentalWorks
 * mirror. "A job closed" can happen from the yard, from a mark-returned
 * button, or from a status edit. Hooking every one of those means the
 * notice silently stops working the first time someone adds a sixth path —
 * and nothing fails loudly when a notification simply never fires.
 *
 * So detection reads STATE, once a day, and asks what changed. Which is
 * only safe if re-running cannot re-send, so every notice is written to
 * CompanyPortalNotice under a unique (access, event, subject) key. The
 * constraint IS the guarantee: a double run, a retry, a manual trigger and
 * a redeploy mid-sweep all collapse to one email.
 *
 * ── The window, and why it is not "since the last run" ─────────────────
 * A lookback window rather than a watermark. A watermark that advances on
 * a partially-failed run drops everything the failed half would have sent,
 * with no trace. A 3-day lookback re-examines recent history every night
 * and the ledger discards what already went — so a missed night heals
 * itself instead of leaving a hole.
 */

import type { CompanyPortalEvent } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { deriveJobDateRange } from '@/lib/jobs/dateRange'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import {
  renderCompanyPortalNotice,
  renderCompanyPortalDigest,
} from '@/lib/email/templates/companyPortal'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

/** How far back detection looks. See the header on why it isn't a watermark. */
const LOOKBACK_DAYS = 3

interface Candidate {
  event: CompanyPortalEvent
  companyId: string
  subjectId: string
  headline: string
  eyebrow: string
  bodyLine: string
  rows: { label: string; value: string }[]
  ctaLabel: string
  ctaPath: string
  /** One line for the weekly digest. */
  digestDetail: string
}

function fmtMoney(n: unknown): string {
  const v = Number(n)
  return Number.isFinite(v)
    ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : '—'
}

function fmtDay(d: Date | null): string {
  if (!d) return 'TBD'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
}

/**
 * Everything that happened recently and is worth telling an executive
 * about, across every company that has at least one live portal grant.
 */
export async function detectCandidates(now: Date = new Date()): Promise<Candidate[]> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // Only companies someone is actually watching — no point deriving state
  // for an account with no readers.
  const watched = await prisma.companyPortalAccess.findMany({
    where: { revokedAt: null },
    select: { companyId: true },
    distinct: ['companyId'],
  })
  const companyIds = watched.map((w) => w.companyId)
  if (companyIds.length === 0) return []

  const out: Candidate[] = []

  // ── INVOICE_PAID ─────────────────────────────────────────────────────
  const paid = await prisma.invoice.findMany({
    where: {
      status: 'PAID',
      paidAt: { gte: since },
      order: { job: { companyId: { in: companyIds } } },
    },
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      paidAt: true,
      order: {
        select: {
          orderNumber: true,
          job: { select: { id: true, jobCode: true, name: true, companyId: true, company: { select: { name: true } }, bookings: { select: { jobName: true } } } },
        },
      },
    },
  })
  for (const inv of paid) {
    const job = inv.order.job
    if (!job) continue
    const jobName = resolveDisplayJobName({
      jobName: job.name,
      bookingJobName: job.bookings[0]?.jobName ?? null,
      companyName: job.company?.name ?? null,
    })
    out.push({
      event: 'INVOICE_PAID',
      companyId: job.companyId,
      subjectId: inv.id,
      headline: 'Invoice paid',
      eyebrow: jobName,
      bodyLine: `Payment on ${jobName} has cleared. Nothing further is needed on this invoice.`,
      rows: [
        { label: 'Show', value: `${jobName} (${job.jobCode})` },
        { label: 'Invoice', value: inv.invoiceNumber },
        { label: 'Amount', value: fmtMoney(inv.total) },
        { label: 'Paid', value: fmtDay(inv.paidAt) },
      ],
      ctaLabel: 'See the show',
      ctaPath: `/portal/company/${job.companyId}/job/${job.id}`,
      digestDetail: `${inv.invoiceNumber} · ${fmtMoney(inv.total)} · ${jobName}`,
    })
  }

  // ── JOB_START / JOB_CLOSED ───────────────────────────────────────────
  // One pass over the recently-touched jobs: both events read the same
  // rows, and querying twice would double the cost for no benefit.
  const jobs = await prisma.job.findMany({
    where: {
      companyId: { in: companyIds },
      status: { not: 'LOST' },
      OR: [{ updatedAt: { gte: since } }, { returnedAt: { gte: since } }],
    },
    select: {
      id: true,
      jobCode: true,
      name: true,
      status: true,
      companyId: true,
      returnedAt: true,
      company: { select: { name: true } },
      agent: { select: { name: true } },
      bookings: { select: { startDate: true, endDate: true, status: true, jobName: true } },
      orders: { select: { startDate: true, endDate: true, status: true } },
      jobContacts: {
        select: { role: true, isPrimary: true, person: { select: { firstName: true, lastName: true } } },
      },
    },
  })

  for (const job of jobs) {
    const range = deriveJobDateRange(job.orders, job.bookings)
    const jobName = resolveDisplayJobName({
      jobName: job.name,
      bookingJobName: job.bookings[0]?.jobName ?? null,
      companyName: job.company?.name ?? null,
    })
    const lead = job.jobContacts.find((c) => c.isPrimary) || job.jobContacts[0]
    const leadName = lead ? `${lead.person.firstName} ${lead.person.lastName}`.trim() : null

    // JOB_START — the day gear goes out. Fires on the start day itself,
    // and the ledger keeps it to once per job even though the job stays
    // "started" for its whole run.
    if (range.start) {
      const startDay = new Date(
        Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), range.start.getUTCDate()),
      )
      const daysAgo = (today.getTime() - startDay.getTime()) / 86_400_000
      if (daysAgo >= 0 && daysAgo <= LOOKBACK_DAYS && !job.returnedAt) {
        out.push({
          event: 'JOB_START',
          companyId: job.companyId,
          subjectId: job.id,
          headline: 'A show is under way',
          eyebrow: jobName,
          bodyLine: `${jobName} started ${fmtDay(range.start)}.`,
          rows: [
            { label: 'Show', value: `${jobName} (${job.jobCode})` },
            { label: 'Dates', value: `${fmtDay(range.start)} → ${fmtDay(range.end)}` },
            ...(leadName ? [{ label: 'Lead', value: leadName }] : []),
            ...(job.agent?.name ? [{ label: 'Your rep', value: job.agent.name }] : []),
          ],
          ctaLabel: 'See the show',
          ctaPath: `/portal/company/${job.companyId}/job/${job.id}`,
          digestDetail: `Started ${fmtDay(range.start)}${leadName ? ` · ${leadName}` : ''}`,
        })
      }
    }

    // JOB_CLOSED — everything back. `returnedAt` is the single kill switch
    // both the yard and the board write; a WRAPPED status is the human
    // off-ramp for the same fact.
    const closedAt = job.returnedAt
    if ((closedAt && closedAt >= since) || (job.status === 'WRAPPED' && !closedAt)) {
      out.push({
        event: 'JOB_CLOSED',
        companyId: job.companyId,
        subjectId: job.id,
        headline: 'A show has wrapped',
        eyebrow: jobName,
        bodyLine: `${jobName} is closed out on our side — everything is back.`,
        rows: [
          { label: 'Show', value: `${jobName} (${job.jobCode})` },
          { label: 'Dates', value: `${fmtDay(range.start)} → ${fmtDay(range.end)}` },
          ...(closedAt ? [{ label: 'Returned', value: fmtDay(closedAt) }] : []),
        ],
        ctaLabel: 'See the invoices',
        ctaPath: `/portal/company/${job.companyId}/job/${job.id}`,
        digestDetail: `Wrapped${closedAt ? ` ${fmtDay(closedAt)}` : ''}`,
      })
    }
  }

  // ── QUOTE_SENT ───────────────────────────────────────────────────────
  const quoted = await prisma.order.findMany({
    where: {
      quoteSentAt: { gte: since },
      job: { companyId: { in: companyIds } },
    },
    select: {
      id: true,
      orderNumber: true,
      quoteSentAt: true,
      total: true,
      job: {
        select: {
          id: true,
          jobCode: true,
          name: true,
          companyId: true,
          company: { select: { name: true } },
          bookings: { select: { jobName: true } },
        },
      },
    },
  })
  for (const order of quoted) {
    const job = order.job
    if (!job) continue
    const jobName = resolveDisplayJobName({
      jobName: job.name,
      bookingJobName: job.bookings[0]?.jobName ?? null,
      companyName: job.company?.name ?? null,
    })
    out.push({
      event: 'QUOTE_SENT',
      companyId: job.companyId,
      // Keyed on the ORDER — a job can be quoted more than once and each
      // quote is its own event.
      subjectId: order.id,
      headline: 'A quote went out',
      eyebrow: jobName,
      bodyLine: `We sent a quote for ${jobName} to your team.`,
      rows: [
        { label: 'Show', value: `${jobName} (${job.jobCode})` },
        { label: 'Order', value: order.orderNumber },
        { label: 'Sent', value: fmtDay(order.quoteSentAt) },
      ],
      ctaLabel: 'Open your account',
      ctaPath: `/portal/company/${job.companyId}`,
      digestDetail: `${order.orderNumber} · ${jobName}`,
    })
  }

  return out
}

const FLAG_FOR_EVENT: Record<CompanyPortalEvent, string> = {
  JOB_START: 'notifyJobStart',
  INVOICE_PAID: 'notifyInvoicePaid',
  JOB_CLOSED: 'notifyJobClosed',
  QUOTE_SENT: 'notifyQuoteSent',
}

export interface SweepResult {
  candidates: number
  claimed: number
  mailed: number
  digests: number
  failed: number
}

/**
 * Detect, claim and send.
 *
 * "Claim" is the write to CompanyPortalNotice, and it happens BEFORE the
 * email. Getting that order wrong is the difference between one duplicate
 * email (claim fails after send) and a silent miss (send fails after
 * claim) — and between those two, a duplicate is recoverable and a miss is
 * invisible. So: claim first, and a send failure leaves `mailedAt` null,
 * which is queryable ("what did we claim but never deliver") in a way a
 * missing row never is.
 */
export async function runCompanyPortalNotices(
  now: Date = new Date(),
  opts: { dryRun?: boolean } = {},
): Promise<SweepResult> {
  const candidates = await detectCandidates(now)
  const result: SweepResult = {
    candidates: candidates.length,
    claimed: 0,
    mailed: 0,
    digests: 0,
    failed: 0,
  }
  if (candidates.length === 0) return result

  const byCompany = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const list = byCompany.get(c.companyId) || []
    list.push(c)
    byCompany.set(c.companyId, list)
  }

  const accesses = await prisma.companyPortalAccess.findMany({
    where: { revokedAt: null, companyId: { in: [...byCompany.keys()] } },
    select: {
      id: true,
      companyId: true,
      cadence: true,
      notifyJobStart: true,
      notifyInvoicePaid: true,
      notifyJobClosed: true,
      notifyQuoteSent: true,
      company: { select: { name: true } },
      person: { select: { firstName: true, email: true } },
    },
  })

  const base = baseUrl()

  for (const access of accesses) {
    if (access.cadence === 'NONE') continue
    const list = byCompany.get(access.companyId) || []

    // Everything this person has elected to hear about and has not been
    // told yet.
    const claimedForThisRun: { candidate: Candidate; noticeId: string }[] = []

    for (const c of list) {
      const flag = FLAG_FOR_EVENT[c.event] as keyof typeof access
      if (!access[flag]) continue

      if (opts.dryRun) {
        result.claimed++
        continue
      }

      // The unique constraint is what makes this idempotent — a row that
      // already exists throws and we move on rather than re-sending.
      let noticeId: string | null = null
      try {
        const notice = await prisma.companyPortalNotice.create({
          data: {
            accessId: access.id,
            event: c.event,
            subjectId: c.subjectId,
            summary: `${c.headline}: ${c.bodyLine}`,
          },
          select: { id: true },
        })
        noticeId = notice.id
      } catch {
        continue // already told them
      }
      result.claimed++
      claimedForThisRun.push({ candidate: c, noticeId })
    }

    if (opts.dryRun || claimedForThisRun.length === 0) continue

    const firstName = access.person.firstName || 'there'
    const portalUrl = `${base}/portal/company/${access.companyId}`

    if (access.cadence === 'WEEKLY') {
      // Claimed now, mailed on the weekly run — the rows sit with
      // `mailedAt` null until then. Sending happens in the same sweep only
      // on the digest day; see the cron.
      continue
    }

    for (const { candidate, noticeId } of claimedForThisRun) {
      const { subject, html, text } = renderCompanyPortalNotice({
        firstName,
        companyName: access.company.name,
        portalUrl,
        headline: candidate.headline,
        eyebrow: candidate.eyebrow,
        rows: candidate.rows,
        bodyLine: candidate.bodyLine,
        ctaLabel: candidate.ctaLabel,
        ctaHref: `${base}${candidate.ctaPath}`,
      })
      const sent = await sendAgreementEmail({
        to: [access.person.email],
        subject,
        html,
        text,
        label: `company-portal-${candidate.event.toLowerCase()}`,
      })
      if (sent.ok) {
        result.mailed++
        await prisma.companyPortalNotice.update({
          where: { id: noticeId },
          data: { mailedAt: new Date() },
        })
      } else {
        result.failed++
        console.error(
          `[company-portal-notices] send failed for ${access.person.email}:`,
          sent.reason,
        )
      }
    }
  }

  return result
}

/**
 * Flush the WEEKLY queue — everything claimed but never mailed, rolled
 * into one email per person. Run on the digest day only.
 */
export async function runCompanyPortalDigests(): Promise<{ sent: number; failed: number }> {
  const pending = await prisma.companyPortalNotice.findMany({
    where: { mailedAt: null, access: { cadence: 'WEEKLY', revokedAt: null } },
    select: {
      id: true,
      event: true,
      summary: true,
      access: {
        select: {
          id: true,
          companyId: true,
          company: { select: { name: true } },
          person: { select: { firstName: true, email: true } },
        },
      },
    },
    orderBy: { sentAt: 'asc' },
    take: 2000,
  })

  const byAccess = new Map<string, typeof pending>()
  for (const n of pending) {
    const list = byAccess.get(n.access.id) || []
    list.push(n)
    byAccess.set(n.access.id, list)
  }

  const base = baseUrl()
  let sent = 0
  let failed = 0

  for (const [, notices] of byAccess) {
    const access = notices[0].access
    const { subject, html, text } = renderCompanyPortalDigest({
      firstName: access.person.firstName || 'there',
      companyName: access.company.name,
      portalUrl: `${base}/portal/company/${access.companyId}`,
      items: notices.map((n) => {
        const [headline, ...rest] = (n.summary || '').split(': ')
        return { headline: headline || n.event, detail: rest.join(': ') }
      }),
    })
    const result = await sendAgreementEmail({
      to: [access.person.email],
      subject,
      html,
      text,
      label: 'company-portal-digest',
    })
    if (result.ok) {
      sent++
      await prisma.companyPortalNotice.updateMany({
        where: { id: { in: notices.map((n) => n.id) } },
        data: { mailedAt: new Date() },
      })
    } else {
      failed++
      console.error('[company-portal-digest] send failed:', result.reason)
    }
  }

  return { sent, failed }
}
