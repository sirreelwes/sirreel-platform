/**
 * Jobs the CLIENT set up themselves that nobody has quoted yet.
 *
 * ONE query, read by every surface that mentions them, so the action-item
 * queue and the twice-daily brief can never disagree about what is
 * waiting — the same discipline as inquirySla.ts, and for the same reason
 * (an escalation on one surface that another surface calls "all caught
 * up" is how the original gap survived).
 *
 * Readers:
 *   - src/lib/actionItems/providers/clientCreatedUnquoted.ts
 *   - src/lib/email/dailyBrief.ts  (its own section, and excluded from the
 *     "unsent drafts" count so one job is never reported twice under two
 *     different stories)
 *
 * WHAT MAKES A JOB "CLIENT-CREATED": an `AgreementEntry` row whose
 * `createdInquiryId` is stamped. That column is written only by the
 * START_NEW submit on the public rental-agreement page
 * (src/lib/public/agreementEntry.ts). An agent-sent welcome invite runs
 * through the same startWelcomeInvite mint but never writes an
 * AgreementEntry, so a job a rep set in motion cannot appear here.
 *
 * WHY IT NEEDS ITS OWN SURFACE (Wes 2026-09-07): the Inquiry these create
 * is born CONVERTED, so `inquiryPastResponseSla` — which bails on any
 * status but NEW — skips it, taking the safety-net cron, the
 * untouched-inquiry item, the New inbound red treatment and the Incoming
 * pill with it. `quote-aging` counts from a `quoteSentAt` that never
 * happened. Chaotic Neutral LTD signed a rental agreement for a rental
 * five days out and nothing anywhere said so.
 */

import { prisma } from '@/lib/prisma'

const SIGNED_STATUSES = ['SIGNED_BASELINE', 'SIGNED_NEGOTIATED', 'SIGNED_OFFLINE'] as const

/** Undated self-serve jobs stop being news after this long. */
export const CLIENT_CREATED_STALE_DAYS = 30

export interface ClientCreatedJob {
  orderId: string
  orderNumber: string
  jobId: string
  jobCode: string
  jobName: string
  companyName: string | null
  /** ISO calendar days, from the order's own window. */
  start: string | null
  end: string | null
  /** They have already signed the rental agreement. */
  agreementSigned: boolean
  lineCount: number
  agentName: string | null
  /** When the client set it up — the clock that matters, not the order's. */
  createdAt: Date
}

/**
 * `includeStale: true` returns rows whose rental window has already
 * passed. Default false: a dead window cannot be confirmed, so it is a
 * post-mortem rather than a queue item, and leaving it in a work surface
 * means it sits there until dismissed by hand. Those rows stay visible on
 * the /jobs board, which is where a dead lead belongs.
 */
export async function listClientCreatedUnquoted(
  opts: { includeStale?: boolean; now?: Date } = {},
): Promise<ClientCreatedJob[]> {
  const now = opts.now ?? new Date()

  const entries = await prisma.agreementEntry.findMany({
    where: { createdInquiryId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { createdInquiryId: true },
  })
  const inquiryIds = entries
    .map((e) => e.createdInquiryId)
    .filter((id): id is string => !!id)
  if (!inquiryIds.length) return []

  const inquiries = await prisma.inquiry.findMany({
    where: { id: { in: inquiryIds }, convertedJobId: { not: null } },
    select: { createdAt: true, convertedJobId: true },
  })
  const jobIds = inquiries
    .map((i) => i.convertedJobId)
    .filter((id): id is string => !!id)
  if (!jobIds.length) return []
  const entryAt = new Map(inquiries.map((i) => [i.convertedJobId!, i.createdAt]))

  const orders = await prisma.order.findMany({
    where: {
      jobId: { in: jobIds },
      // DRAFT with no quote ever sent === nobody has priced it. A quote
      // that HAS gone out is quote-aging's problem, not this one's.
      status: 'DRAFT',
      quoteSentAt: null,
      job: { status: { notIn: ['LOST', 'WRAPPED'] }, archivedAt: null },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: {
      id: true,
      orderNumber: true,
      startDate: true,
      endDate: true,
      createdAt: true,
      job: {
        select: {
          id: true,
          jobCode: true,
          name: true,
          company: { select: { name: true } },
          agent: { select: { name: true, email: true } },
        },
      },
      _count: { select: { lineItems: true } },
      signedAgreements: {
        where: { status: { in: [...SIGNED_STATUSES] } },
        select: { id: true },
        take: 1,
      },
    },
  })

  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

  return orders
    .filter((o) => {
      if (opts.includeStale) return true
      if (o.startDate) return o.startDate.getTime() >= now.getTime() - 86_400_000
      return o.createdAt.getTime() >= now.getTime() - CLIENT_CREATED_STALE_DAYS * 86_400_000
    })
    .map((o) => {
      const job = o.job!
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        jobId: job.id,
        jobCode: job.jobCode,
        jobName: job.name,
        companyName: job.company?.name ?? null,
        start: iso(o.startDate),
        end: iso(o.endDate),
        agreementSigned: o.signedAgreements.length > 0,
        lineCount: o._count.lineItems,
        agentName: job.agent?.name || job.agent?.email || null,
        createdAt: entryAt.get(job.id) ?? o.createdAt,
      }
    })
}

/**
 * "signed · nothing on the order · starts in 5 days" — the one-line state
 * both the action item and the brief print, so the two read identically.
 */
export function describeClientCreatedJob(j: ClientCreatedJob, now: Date = new Date()): string {
  const bits: string[] = [
    j.agreementSigned ? 'agreement signed' : 'agreement not signed yet',
    j.lineCount === 0
      ? 'nothing on the order'
      : `${j.lineCount} line${j.lineCount === 1 ? '' : 's'}, unpriced`,
  ]
  if (j.start) {
    const days = Math.ceil((Date.parse(j.start + 'T12:00:00Z') - now.getTime()) / 86_400_000)
    bits.push(
      days < 0
        ? 'start date has passed'
        : days === 0
          ? 'starts today'
          : days === 1
            ? 'starts tomorrow'
            : `starts in ${days} days`,
    )
  } else {
    bits.push('no dates given')
  }
  return bits.join(' · ')
}
