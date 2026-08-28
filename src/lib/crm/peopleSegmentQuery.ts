/**
 * Server side of the People segment chips — the Prisma `where` for a
 * segment, and the population counts for the chip labels.
 *
 * Split from peopleSegments.ts because that module is imported by the
 * client page for its labels and must stay Prisma-free.
 *
 * Two of the seven segments need a pre-query before they can become a
 * `where` (they filter on facts that live in other tables):
 *
 *   neverContacted — "no OutreachActivity and no Activity" is an
 *     absence across two tables. Prisma expresses that natively with
 *     `{ outreachActivities: { none: {} }, activities: { none: {} } }`,
 *     which is what we use — no pre-query needed after all.
 *   topClientStaff — needs the population spend cutoff first, the same
 *     one /api/crm/stats hands the Companies chips, so "top client"
 *     means one thing across the whole CRM.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { fetchPopulationTopClientCutoff } from '@/lib/crm/clientBadges'
import {
  PEOPLE_REPEAT_MIN,
  PEOPLE_SEGMENT_KEYS,
  emptySegmentCounts,
  segmentCutoffs,
  type PeopleSegmentCounts,
  type PeopleSegmentKey,
} from '@/lib/crm/peopleSegments'

export interface SegmentContext {
  /** Current user's User.id — required for the `mine` segment. */
  viewerUserId: string | null
  now?: Date
}

/**
 * The `where` fragment for one segment, or `{}` for no segment.
 *
 * Returns a fragment to be AND-ed with the caller's own search/role
 * clauses rather than a complete where, so segment + search + role
 * compose instead of overwriting each other.
 */
export async function segmentWhere(
  segment: PeopleSegmentKey | null,
  ctx: SegmentContext,
): Promise<Prisma.PersonWhereInput> {
  if (!segment) return {}
  const { quietBefore, newAfter } = segmentCutoffs(ctx.now ?? new Date())

  switch (segment) {
    case 'noRole':
      return { role: 'OTHER' }

    case 'neverContacted':
      return { outreachActivities: { none: {} }, activities: { none: {} } }

    case 'quiet':
      // COMPANY grain. Rental history exists only per company — the RW
      // invoice mirror carries no person — so this asks "does this
      // contact work somewhere that has gone quiet", which is what the
      // label promises. Requires prior rental history: a client who has
      // never rented is not quiet, they are new.
      return {
        affiliations: {
          some: { company: { lastRentalAt: { not: null, lt: quietBefore } } },
        },
      }

    case 'repeat':
      return {
        affiliations: { some: { company: { totalBookings: { gte: PEOPLE_REPEAT_MIN } } } },
      }

    case 'newContacts':
      return { createdAt: { gte: newAfter } }

    case 'mine':
      // No viewer resolved → match nothing, rather than matching
      // everyone with a null assignee, which would be a confusing and
      // very large "my contacts".
      return ctx.viewerUserId ? { assignedAgentId: ctx.viewerUserId } : { id: { in: [] } }

    case 'topClientStaff': {
      const cutoff = await fetchPopulationTopClientCutoff()
      if (cutoff <= 0) return { id: { in: [] } }
      return { affiliations: { some: { company: { totalSpend: { gte: cutoff } } } } }
    }
  }
}

/**
 * Population counts for every chip, in one pass.
 *
 * Runs the counts CONCURRENTLY and against the same base clause the
 * list is using (so a search narrows the chips too), but deliberately
 * NOT against the active segment — narrowing the chips by the chip you
 * just clicked would zero every other one and make the strip useless.
 */
export async function fetchSegmentCounts(
  baseWhere: Prisma.PersonWhereInput,
  ctx: SegmentContext,
): Promise<PeopleSegmentCounts> {
  const counts = emptySegmentCounts()
  const entries = await Promise.all(
    PEOPLE_SEGMENT_KEYS.map(async (key) => {
      const frag = await segmentWhere(key, ctx)
      const n = await prisma.person.count({ where: { AND: [baseWhere, frag] } })
      return [key, n] as const
    }),
  )
  for (const [key, n] of entries) counts[key as PeopleSegmentKey] = n
  return counts
}
