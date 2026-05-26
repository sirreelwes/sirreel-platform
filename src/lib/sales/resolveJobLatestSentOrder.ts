/**
 * Resolves a Job to its most-recently-sent QUOTE_SENT Order — the
 * target of a follow-up nudge from the pipeline Kanban.
 *
 * Shared between the job-scoped send wrapper and the job-scoped
 * preview wrapper so both surfaces pick the SAME order. The Kanban
 * groups by Job and carries no Order id, so this resolution must live
 * server-side; doing it twice in two route files would let them
 * silently diverge.
 *
 * Returns null when:
 *   - the Job has no SENT order
 *   - the Job has reached WRAPPED/LOST (defensive — usually filtered
 *     upstream by the panel/data layer, but guarding here keeps the
 *     contract correct if a stale client hits the endpoint)
 */

import { prisma } from '@/lib/prisma'

export async function resolveJobLatestSentOrder(jobId: string): Promise<{ id: string } | null> {
  return prisma.order.findFirst({
    where: {
      jobId,
      quoteStatus: 'SENT',
      job: { status: { notIn: ['WRAPPED', 'LOST'] } },
    },
    orderBy: [
      // sentAt is the actual quote-sent timestamp; fall back to quoteSentAt
      // for older rows that pre-date the sales-stage column split.
      { sentAt: 'desc' },
      { quoteSentAt: 'desc' },
    ],
    select: { id: true },
  })
}
