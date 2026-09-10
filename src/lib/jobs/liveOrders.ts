/**
 * The orders a job's DERIVED state is allowed to read.
 *
 * `POST /api/orders/[id]/archive` is the app's answer to a duplicate —
 * deliberately not a status, because "an abandoned parse or a duplicate
 * is not cancelled". The LCDW election applier already honours it
 * (`archivedAt: null` in its order query), but the job rollups did not:
 * they filtered CANCELLED only, so an archived twin kept driving the
 * cadence chip, the readiness rail and the header's deal value. That is
 * how SR-JOB-0332 read BOOKED off S260909-003 — a phantom the double-
 * click bug minted ten seconds before the real quote (fixed 2026-09-09,
 * 9f1d07ce) — while the order the client actually holds sat at
 * QUOTE_SENT.
 *
 * The fallback matters: archiving a job's ONLY order must not leave the
 * rollup with nothing to read (SR-JOB-0100 is in exactly that state), so
 * an empty result reverts to the non-cancelled set. Archive hides a
 * duplicate; it never blanks a job.
 */
export function liveOrdersForRollup<T extends { status: string; archivedAt?: Date | string | null }>(
  orders: T[],
): T[] {
  const notCancelled = orders.filter((o) => o.status !== 'CANCELLED')
  const unarchived = notCancelled.filter((o) => !o.archivedAt)
  return unarchived.length > 0 ? unarchived : notCancelled
}
