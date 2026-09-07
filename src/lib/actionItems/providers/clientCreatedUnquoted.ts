/**
 * Client-created job with nothing quoted (DERIVED).
 *
 * The public rental-agreement page lets a client set up their own Job and
 * Order and sign the agreement, with no agent involved at any point. That
 * is a good thing — the paperwork is moving before anyone picks up the
 * phone — but until 2026-09-07 it produced NO trigger for anybody to act
 * on. The query, the "why nothing else fires" note and the one-line state
 * all live in src/lib/sales/clientCreatedJobs.ts, shared with the twice-
 * daily brief so the queue and the email cannot disagree.
 *
 * Priority is HIGH the moment it exists, not after an SLA window: the
 * client has been handed a portal that says their rep will confirm, and a
 * signed agreement raises the stakes rather than lowering them.
 * Deliberately UNSCOPED, same reasoning as inquiryUntouched — a self-serve
 * job belongs to whoever can price it first.
 */

import type { UserRole } from '@prisma/client'
import type { ActionItem, ActionItemProvider } from '@/lib/actionItems/types'
import { describeClientCreatedJob, listClientCreatedUnquoted } from '@/lib/sales/clientCreatedJobs'

const OWNER: UserRole[] = ['AGENT', 'ADMIN', 'MANAGER']

export const clientCreatedUnquotedProvider: ActionItemProvider = {
  id: 'client-created-unquoted',
  kind: 'DERIVED',
  async fetch(): Promise<ActionItem[]> {
    const now = new Date()
    const jobs = await listClientCreatedUnquoted({ now })

    return jobs.map((j) => {
      const subject = [j.companyName, j.jobName].filter(Boolean).join(' · ') || j.jobCode
      const tail = j.agentName ? ` Assigned to ${j.agentName}.` : ' Nobody assigned.'
      return {
        id: `client-created-unquoted:${j.orderId}`,
        type: 'client_created_unquoted',
        title: `Client set this up themselves — ${subject}`,
        subtitle: `${describeClientCreatedJob(j, now)}.${tail} Confirm availability and send a quote — the portal tells them it is not booked until you do.`,
        ownerRole: OWNER,
        priority: 'high' as const,
        href: `/jobs/${j.jobId}`,
        occurredAt: j.createdAt,
        source: 'client-created-unquoted',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
