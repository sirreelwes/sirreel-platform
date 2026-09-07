/**
 * Client-created job with nothing quoted (DERIVED).
 *
 * The public rental-agreement page lets a client set up their own Job and
 * Order and sign the agreement, with no agent involved at any point
 * (src/lib/public/agreementEntry.ts, the START_NEW branch). That is a good
 * thing — the paperwork is moving before anyone picks up the phone — but
 * until now it produced NO trigger for anybody to act on:
 *
 *   - The Inquiry is created and converted in the same operation, so its
 *     status is CONVERTED, never NEW. `inquiryPastResponseSla` bails on
 *     any status but NEW, which means the untouched-inquiry provider, the
 *     safety-net cron, the New inbound red treatment and the Incoming
 *     pill ALL skip it.
 *   - `quote-aging` only counts from `quoteSentAt`, and no quote was ever
 *     sent.
 *   - The notification emails went to the shared hq@ inbox only.
 *
 * Found 2026-09-07 (Wes: "if a client creates an order on their own,
 * what's our trigger to respond and make it a job that can proceed?").
 * Chaotic Neutral LTD set up SR-JOB-0315 and SIGNED the rental agreement
 * for a rental five days out; the order sat DRAFT at $0 with no lines, no
 * clock running and no named owner.
 *
 * The marker for "the client did this themselves" is
 * `AgreementEntry.createdInquiryId` — stamped only by the self-serve
 * submit path. An agent-sent welcome invite goes through
 * startWelcomeInvite too but never writes an AgreementEntry, so this
 * provider cannot fire on a job a rep set in motion.
 *
 * Priority is HIGH the moment it exists, not after an SLA window: the
 * client has been handed a portal that says their rep will confirm, and
 * a signed agreement raises the stakes rather than lowering them.
 * Deliberately UNSCOPED, same reasoning as inquiryUntouched — a
 * self-serve job belongs to whoever can price it first.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider } from '@/lib/actionItems/types'

const OWNER: UserRole[] = ['AGENT', 'ADMIN', 'MANAGER']

/** Orders nobody has priced yet. A quote that has been SENT is quote-aging's problem. */
const UNQUOTED_STATUSES = ['DRAFT'] as const

export const clientCreatedUnquotedProvider: ActionItemProvider = {
  id: 'client-created-unquoted',
  kind: 'DERIVED',
  async fetch(): Promise<ActionItem[]> {
    // Self-serve entries that actually minted an inquiry.
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
      select: { id: true, createdAt: true, convertedJobId: true },
    })
    const jobIds = inquiries
      .map((i) => i.convertedJobId)
      .filter((id): id is string => !!id)
    if (!jobIds.length) return []
    const entryAt = new Map(inquiries.map((i) => [i.convertedJobId!, i.createdAt]))

    const orders = await prisma.order.findMany({
      where: {
        jobId: { in: jobIds },
        status: { in: [...UNQUOTED_STATUSES] },
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
          where: { status: { in: ['SIGNED_BASELINE', 'SIGNED_NEGOTIATED', 'SIGNED_OFFLINE'] } },
          select: { id: true },
          take: 1,
        },
      },
    })

    const today = new Date()
    const STALE_UNDATED_DAYS = 30
    return orders
      // A rental whose start date has passed cannot be confirmed — there
      // is nothing left to quote, and leaving it here turns the queue
      // into a post-mortem that has to be dismissed by hand. Undated ones
      // age out on their own instead. The stale rows stay visible on the
      // /jobs board, which is where a dead lead belongs.
      .filter((o) => {
        if (o.startDate) return o.startDate.getTime() >= today.getTime() - 86_400_000
        return o.createdAt.getTime() >= today.getTime() - STALE_UNDATED_DAYS * 86_400_000
      })
      .map((o) => {
      const job = o.job!
      const signed = o.signedAgreements.length > 0
      const who = job.agent?.name || job.agent?.email
      const company = job.company?.name

      // Days to the rental, when they gave dates. A signed agreement for
      // next week reads very differently from one with no dates at all.
      const start = o.startDate
      const days =
        start != null
          ? Math.ceil((start.getTime() - today.getTime()) / 86_400_000)
          : null
      const when =
        days == null
          ? 'no dates given'
          : days < 0
            ? 'start date has passed'
            : days === 0
              ? 'starts today'
              : days === 1
                ? 'starts tomorrow'
                : `starts in ${days} days`

      const subject = [company, job.name].filter(Boolean).join(' · ') || job.jobCode
      const bits = [
        signed ? 'They have signed the rental agreement' : 'Agreement not signed yet',
        o._count.lineItems === 0 ? 'nothing on the order' : `${o._count.lineItems} line${o._count.lineItems === 1 ? '' : 's'}, unpriced`,
        when,
      ]
      const tail = who ? ` Assigned to ${who}.` : ' Nobody assigned.'

      return {
        id: `client-created-unquoted:${o.id}`,
        type: 'client_created_unquoted',
        title: `Client set this up themselves — ${subject}`,
        subtitle: `${bits.join(' · ')}.${tail} Confirm availability and send a quote — the portal tells them it is not booked until you do.`,
        ownerRole: OWNER,
        priority: 'high' as const,
        href: `/jobs/${job.id}`,
        occurredAt: entryAt.get(job.id) ?? o.createdAt,
        source: 'client-created-unquoted',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
