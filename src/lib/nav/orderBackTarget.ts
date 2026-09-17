/**
 * Where "back" goes from an order page.
 *
 * Wes 2026-09-17: "From Job our agent opens an order, once finished they
 * press back expecting to go back to job detail page out of order, but it
 * skips job detail and goes all the way to master jobs page. It should
 * return to job detail page."
 *
 * The order page's back control was a fixed `router.push("/orders")` — it
 * always went to the master list, whatever door you came in by, so an agent
 * working a job was dropped into a list of every order and had to find
 * their way back. (The BROWSER back button was never the problem: nothing
 * in /jobs replaces history, so it has always returned to the job. The
 * on-page arrow is the one people press.)
 *
 * So a link INTO an order says where it came from, and the order page reads
 * it. An order belongs to exactly one Job, so "I came from a job" is all
 * the link has to carry — the destination is the order's own job, never an
 * id out of the URL. That matters: nothing here can be pointed at a path an
 * attacker chose, because no path is ever read from the query string.
 *
 * A link with no marker still goes to the Orders list, so the rep working
 * down that list is not thrown into a job they never opened.
 */

/** The marker a job-side link carries. */
export const FROM_JOB = 'job'

export interface BackTarget {
  href: string
  /** Rendered after the arrow, so it names the place you land. */
  label: string
}

export const ORDERS_LIST: BackTarget = { href: '/orders', label: 'Back to Orders' }

/** The href a job-side link should use to open one of its orders. */
export function orderHrefFromJob(orderId: string): string {
  return `/orders/${orderId}?from=${FROM_JOB}`
}

/**
 * The back control for an order page: the job when that is where the agent
 * came from and the order has one, the Orders list otherwise.
 */
export function orderBackTarget(args: {
  from: string | null | undefined
  job: { id: string; jobCode: string } | null | undefined
}): BackTarget {
  const { from, job } = args
  if (from === FROM_JOB && job?.id) {
    return { href: `/jobs/${job.id}`, label: `Back to ${job.jobCode || 'the job'}` }
  }
  return ORDERS_LIST
}
