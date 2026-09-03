/**
 * "Is this job physically back?" — the one definition, shared by both
 * lanes that can answer it.
 *
 * `Job.returnedAt` is the not-returned kill switch: the /jobs rail reads
 * it to decide whether a job is overdue, and until now the only thing
 * that ever wrote it was the manual "returned" button, whose route
 * says in as many words that it is "the manual v1 stand-in for the
 * future warehouse check-in flow, which will write the same field".
 * This is that flow. Both the vehicle return inspection and the gear
 * check-in call in here when they close their own piece, and whichever
 * one finishes last stamps the job.
 *
 * The rule is deliberately CONSERVATIVE — it stamps only when the job
 * has nothing outstanding in the yard at all:
 *
 * - no BookingAssignment still ASSIGNED or CHECKED_OUT (a truck that
 * is out, or was never received)
 * - every PickList either CHECKED_IN or CANCELLED (nothing waiting to
 * be picked, staged, loaded, or counted back)
 *
 * So a job with a second order still to go out does NOT get stamped
 * when its first truck comes home. The failure mode is under-stamping —
 * returnedAt stays null and the manual button still works — which is
 * the right way to be wrong: over-stamping would silently clear a real
 * overdue while a vehicle is still on a set somewhere.
 *
 * Never un-stamps, and never overwrites an existing value. Undo stays
 * with /api/jobs/[id]/unmark-returned, which is where a human can see
 * what they are reversing.
 */

import { prisma } from '@/lib/prisma'

/** Assignment states that mean the unit has not been received back. */
const VEHICLE_OUT = ['ASSIGNED', 'CHECKED_OUT'] as const
/** Pick-list states that mean the gear is not settled. */
const GEAR_OPEN = [
  'DRAFT', 'PICKING', 'READY_TO_STAGE', 'STAGED', 'LOADED', 'CHECKING_IN',
] as const

export interface SettleResult {
  /** Whether this call is what stamped the job. */
  stamped: boolean
  /** Why not, when it didn't — useful in the API response and in logs. */
  reason?: 'no-job' | 'already-stamped' | 'vehicles-out' | 'gear-open'
}

export async function settleJobReturn(
  jobId: string | null | undefined,
  userId: string,
): Promise<SettleResult> {
  if (!jobId) return { stamped: false, reason: 'no-job' }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, returnedAt: true },
  })
  if (!job) return { stamped: false, reason: 'no-job' }
  if (job.returnedAt) return { stamped: false, reason: 'already-stamped' }

  const vehiclesOut = await prisma.bookingAssignment.count({
    where: {
      status: { in: [...VEHICLE_OUT] },
      bookingItem: { booking: { jobId } },
    },
  })
  if (vehiclesOut > 0) return { stamped: false, reason: 'vehicles-out' }

  const gearOpen = await prisma.pickList.count({
    where: { status: { in: [...GEAR_OPEN] }, order: { jobId } },
  })
  if (gearOpen > 0) return { stamped: false, reason: 'gear-open' }

  // updateMany with the null guard rather than update: two techs closing
  // the last truck and the last cart within the same second would
  // otherwise race, and the loser would overwrite the winner's timestamp
  // and attribution.
  const res = await prisma.job.updateMany({
    where: { id: jobId, returnedAt: null },
    data: { returnedAt: new Date(), returnedById: userId },
  })
  return { stamped: res.count > 0, reason: res.count > 0 ? undefined : 'already-stamped' }
}

/** Never let the job-level rollup be the reason a return submission fails. */
export async function settleJobReturnSafe(
  jobId: string | null | undefined,
  userId: string,
): Promise<SettleResult> {
  try {
    return await settleJobReturn(jobId, userId)
  } catch (err) {
    console.error('[settleJobReturn] failed', { jobId, err })
    return { stamped: false }
  }
}
