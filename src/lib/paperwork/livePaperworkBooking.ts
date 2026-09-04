import { prisma } from '@/lib/prisma'
import { isPortalPaperworkLocked } from '@/lib/bookings/status'

/**
 * Keep a client's paperwork link pointed at a booking that still exists.
 *
 * ── The bug this exists for (Dunwell Productions, 2026-09-04) ───────
 * PaperworkRequest is booking-scoped; the paperwork it collects is not.
 * A rental agreement, a COI and a card on file belong to the JOB — the
 * production the client is putting on — and HQ hands out exactly one
 * paperwork link per job (`resolveCardAuthBookingId` picks the job's
 * newest live booking).
 *
 * But rebooking a job is routine: cancel the quote hold, create the
 * reservation that actually goes out. SR-JOB-0294's link was emailed to
 * the client at 16:38:22 and its booking was cancelled at 16:39:13 —
 * fifty-one seconds later. She opened it to a portal reading
 * "Credit Card Authorization — Locked. This booking is no longer
 * active." while her truck was going out the next morning.
 *
 * Nothing about that job was over. The lock in `bookings/status.ts` is
 * meant to say "there is nothing left to paper", and a live sibling
 * booking on the same job disproves that outright.
 *
 * ── What this does ─────────────────────────────────────────────────
 * Follows the request forward onto the job's live booking instead of
 * leaving the client at a dead end. That fixes BOTH halves of the
 * failure: the lock lifts, and the portal stops showing the retired
 * booking's dates and gear (SR-JOB-0294's dead hold carried a cargo
 * van; the live reservation is a SuperCube).
 *
 * Re-pointing rather than merely unlocking matters because every portal
 * WRITE keys off `request.bookingId` — the signed-agreement and
 * COI-received flags would otherwise be stamped onto the cancelled row.
 *
 * Deliberately conservative:
 *  - Only moves a request whose OWN booking is terminal. A live request
 *    is never touched.
 *  - Only moves it to a live booking on the SAME job. No job, no move.
 *  - Never creates or deletes anything; the token the client holds is
 *    preserved, which is the entire point.
 *  - Every move writes an AuditLog carrying the old booking id, so it
 *    is reversible by captured id.
 */

/** The job's newest booking that is still open for paperwork. */
export async function findLivePaperworkBooking(
  jobId: string,
  excludeBookingId?: string,
): Promise<string | null> {
  const live = await prisma.booking.findFirst({
    where: {
      jobId,
      // Mirrors isPortalPaperworkLocked. Kept as an explicit list because
      // this is a DB filter, not a predicate over a value we already hold.
      status: { notIn: ['RETURNED', 'CANCELLED', 'ARCHIVED'] },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  return live?.id ?? null
}

async function movePaperworkRequest(
  requestId: string,
  fromBookingId: string,
  toBookingId: string,
  reason: string,
): Promise<void> {
  await prisma.paperworkRequest.update({
    where: { id: requestId },
    data: { bookingId: toBookingId },
  })
  await prisma.auditLog.create({
    data: {
      action: 'paperwork_request.followed_booking',
      entityType: 'PaperworkRequest',
      entityId: requestId,
      oldValues: { bookingId: fromBookingId },
      newValues: { bookingId: toBookingId, reason },
    },
  })
}

/**
 * Read-path heal, called when a client opens their portal link.
 *
 * Returns the booking id the request should be served from — the same
 * one in the overwhelmingly common case, the job's live booking when the
 * request had been orphaned by a rebook.
 */
export async function healPaperworkRequestBooking(request: {
  id: string
  bookingId: string
  booking: { status: string; jobId: string | null } | null
}): Promise<string> {
  const booking = request.booking
  if (!booking || !booking.jobId) return request.bookingId
  if (!isPortalPaperworkLocked(booking.status)) return request.bookingId

  const liveId = await findLivePaperworkBooking(booking.jobId, request.bookingId)
  if (!liveId) return request.bookingId

  await movePaperworkRequest(request.id, request.bookingId, liveId, 'portal-open')
  return liveId
}

/**
 * Send-path resolver: the PaperworkRequest staff should hand the client
 * for `liveBookingId`, reusing the one already sent for this job.
 *
 * Without this, a rebooked job mints a SECOND token — so the client ends
 * up holding two links, the older one dead, and any card already on the
 * first row invisible to the second.
 *
 * Returns null when the job has no request yet; the caller mints.
 */
export async function adoptJobPaperworkRequest(
  jobId: string,
  liveBookingId: string,
): Promise<{ id: string; token: string } | null> {
  const onLive = await prisma.paperworkRequest.findFirst({
    where: { bookingId: liveBookingId },
    orderBy: { sentAt: 'desc' },
    select: { id: true, token: true },
  })
  if (onLive) return onLive

  // Nothing on the live booking — look for one stranded on a retired
  // sibling. Newest send wins; that is the link the client actually has.
  const stranded = await prisma.paperworkRequest.findFirst({
    where: { booking: { jobId } },
    orderBy: { sentAt: 'desc' },
    select: { id: true, token: true, bookingId: true },
  })
  if (!stranded) return null

  await movePaperworkRequest(stranded.id, stranded.bookingId, liveBookingId, 'staff-resend')
  return { id: stranded.id, token: stranded.token }
}
