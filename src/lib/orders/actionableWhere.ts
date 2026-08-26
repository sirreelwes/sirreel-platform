import type { Prisma } from '@prisma/client'

/**
 * The "is this order still work?" where-fragment, shared by every sales and
 * exec surface that lists live quotes.
 *
 * WHY IT EXISTS. Archive shipped as a filter on /orders and nothing else, so
 * an archived order kept generating work everywhere else: it stayed in the
 * QuotesOutPanel on /inquiries, in the stale-quote signals, in the exec
 * sales-hygiene buckets, in the action-item feed, and the follow-up cron kept
 * drafting new nudges for it. "Archive" that only hides a row on one page is
 * a promise the rest of the app doesn't keep — the same failure the Jobs
 * archive had before 6194362.
 *
 * The job-status half was already copy-pasted across all six call sites with
 * the same comment ("a WRAPPED/LOST job's leftover SENT quote is residue").
 * Archive is the same kind of guard, so both live here now under one name.
 *
 * NOT applied to history surfaces — CRM company/person timelines, reorder
 * history, portal pages. An archived order still happened, and a client's
 * record shouldn't lose it because staff tidied a list.
 */
export const ACTIONABLE_ORDER_WHERE: Prisma.OrderWhereInput = {
  // Visibility-only soft archive (sr_orders.archived_at). NULL = active.
  archivedAt: null,
  // A closed deal's leftover quote is residue; chasing it is noise.
  job: { status: { notIn: ['WRAPPED', 'LOST'] } },
}

/**
 * Same guard expressed from a row that RELATES to an order (e.g.
 * QuoteFollowUp), for use inside a nested `order: { ... }` filter.
 */
export const ACTIONABLE_ORDER_NESTED: Prisma.OrderWhereInput = {
  archivedAt: null,
}
