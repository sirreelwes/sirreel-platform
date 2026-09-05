/**
 * "Has the client committed?" — the one question every sub-rental hold
 * decision hangs on, answered from the ORDER, not from the sub-rental.
 *
 * Why this is its own module: the job panel (a client component) and the
 * hold-request code (server, imports prisma) both need the same answer, and
 * the panel cannot import anything that drags prisma into the browser bundle.
 *
 * A sub-rental's own status says what WE have asked the partner to do. The
 * order's status says what the CLIENT has done. Those drift apart whenever an
 * order is approved or booked from HQ rather than through the portal: the
 * client is committed, but the partner still holds our "this is NOT a
 * booking" estimate notice. Every consumer of this predicate exists to close
 * that gap.
 */

/**
 * Order statuses in which the client has said yes AND the rental is still
 * ahead or under way — the window in which asking a partner to hold means
 * something. Deliberately NOT the post-rental tail (RETURNED, LD_CHECK,
 * INVOICED, CLOSED): a stale ESTIMATED row on a finished order would
 * otherwise shout "not asked to hold" forever and, worse, let a "please
 * hold" go out for dates already past.
 */
export const CLIENT_COMMITTED_ORDER_STATUSES = [
  'APPROVED',
  'BOOKED',
  'LOADED_READY',
  'ON_JOB',
] as const

export function isClientCommittedOrder(status: string | null | undefined): boolean {
  return !!status && (CLIENT_COMMITTED_ORDER_STATUSES as readonly string[]).includes(status)
}
