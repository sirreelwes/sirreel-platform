import type { AgreementStatus } from '@prisma/client'

/**
 * "The client sent the agreement back with changes, and nobody has dealt
 * with it yet."
 *
 * ONE predicate, shared by the /jobs rail chip and the job detail header, so
 * the two surfaces cannot disagree about whether a job is waiting on us.
 *
 * Both states count. REDLINE_UPLOADED is the client's edit landing;
 * UNDER_REVIEW is someone having opened it and not finished — which from the
 * client's side is indistinguishable from silence, and is the state a redline
 * actually dies in. It clears the moment the negotiated version goes back out
 * (NEGOTIATED_READY) or is signed.
 *
 * This is deliberately louder than the readiness chip: readiness describes
 * work WE have to get around to, on outbound rows only. A redline is the
 * client waiting on an answer, and it matters on a job three weeks out
 * exactly as much as one going out tomorrow.
 */
export function isRedlineAwaitingAction(status: AgreementStatus | string): boolean {
  return status === 'REDLINE_UPLOADED' || status === 'UNDER_REVIEW'
}

export function countRedlinesAwaitingAction(
  agreements: Array<{ status: AgreementStatus | string }>,
): number {
  return agreements.filter((a) => isRedlineAwaitingAction(a.status)).length
}
