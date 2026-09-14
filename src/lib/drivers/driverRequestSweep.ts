/**
 * The 48-hour "who's driving?" sweep.
 *
 * Wes 2026-09-14: "we can automate the emails going to clients asking
 * for driver information. It doesn't need to be triggered by an agent
 * because, if the reservation is active, 48 hours before the shoot we
 * should send out a request for a driver if they haven't already
 * uploaded one."
 *
 * Until now the ask only existed as a BUTTON on the job's Drivers card —
 * which means it went out exactly when a rep happened to look. The
 * vehicles that quietly reach pickup morning with nobody named are, by
 * definition, the ones nobody looked at.
 *
 * ── What this file is and isn't ────────────────────────────────────
 *
 * It only decides WHICH jobs to ask and WHEN. Who the mail goes to,
 * what it says, whether there is anything to ask at all, and the
 * stamping all stay in requestDriverFromClient() — the same code path
 * the rep's button uses. A second, drifting definition of "needs a
 * driver" is the failure mode to avoid here, so every gate below is
 * about timing, liveness and not double-tapping; none of them restate
 * the driver rules.
 *
 * ── The gates ─────────────────────────────────────────────────────
 *
 * ACTIVE RESERVATION. A unit actually bound to the job (ASSIGNED or
 * CHECKED_OUT) on a booking that is neither cancelled nor archived, on
 * a job that is not on one of its three human off-ramps (HOLD /
 * WRAPPED / LOST), not archived, and not already marked returned. The
 * job must also own a real order — DRAFT is excluded, because a quote
 * nobody has sent is not a reservation and its contact should not be
 * getting automated mail.
 *
 * THE WINDOW is start-date-based and read in Pacific. BookingAssignment
 * dates are @db.Date (UTC midnight), so the comparison is day-to-day,
 * never hour-to-hour: a job starting today, tomorrow or the day after
 * is inside "48 hours" as a human means it. Running the cron in the
 * MORNING rather than at an exact T-48h is deliberate — a 3am send
 * lands at the bottom of the coordinator's inbox, and the extra few
 * hours of notice are free.
 *
 * ONE ASK PER JOB. Job.driverRequestSentAt is the suppressor, and it is
 * written by the rep's button too, so the sweep will not pile onto an
 * ask a human just made. The suppression is a WINDOW (3 days), not
 * forever: a rep who asked two weeks ago and got ignored is exactly the
 * case this sweep exists to escalate, and a job with a second date
 * block later in the month gets its own ask when that block comes up.
 *
 * Failures are per-job and swallowed into the result: one job with no
 * contact on file must not stop the sweep for the other nine. The
 * "skipped" reasons are the DriverRequestError messages verbatim, so
 * the run's output reads as a to-do list for the rep.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { requestDriverFromClient, DriverRequestError } from './requestDriverFromClient'

/** How far ahead of the start date we ask. 2 days ≈ "48 hours". */
export const SWEEP_WINDOW_DAYS = 2
/** Don't re-ask a job that was asked (by anyone) within this many days. */
export const SWEEP_SUPPRESS_DAYS = 3

export interface SweepSent {
  jobId: string
  jobCode: string | null
  jobName: string
  startDate: string
  sentTo: string
  contactName: string
  vehicles: string[]
  /** null on a dry run — nothing was attempted, so neither true nor false is honest. */
  emailOk: boolean | null
  emailError: string | null
}

export interface SweepSkipped {
  jobId: string
  jobCode: string | null
  jobName: string
  startDate: string
  reason: string
}

export interface SweepResult {
  dryRun: boolean
  /** Pacific day the run treated as "today". */
  today: string
  /** Latest start date inside the window. */
  through: string
  considered: number
  sent: SweepSent[]
  skipped: SweepSkipped[]
}

/**
 * The run's window, as Pacific calendar days. Exported for the test:
 * the boundary is the part of this file most likely to be "simplified"
 * into an hours-based comparison, which would silently drop a job that
 * starts the morning after the run.
 */
export function sweepWindow(now: Date, windowDays = SWEEP_WINDOW_DAYS): { today: string; through: string } {
  const today = pacificToday(now)
  return { today, through: addDays(today, windowDays) }
}

/** Today in Pacific as YYYY-MM-DD. */
function pacificToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** YYYY-MM-DD → the UTC midnight that @db.Date columns store. */
function utcMidnight(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

function addDays(ymd: string, days: number): string {
  const d = utcMidnight(ymd)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function sweepDriverRequests(opts: {
  dryRun?: boolean
  now?: Date
  windowDays?: number
} = {}): Promise<SweepResult> {
  const dryRun = !!opts.dryRun
  const now = opts.now ?? new Date()
  const { today, through } = sweepWindow(now, opts.windowDays ?? SWEEP_WINDOW_DAYS)

  const suppressBefore = new Date(now.getTime() - SWEEP_SUPPRESS_DAYS * 24 * 60 * 60 * 1000)

  // A unit bound to the job, starting inside the window, with nobody
  // named on it. Expressed as a Job query so the unit of work — and the
  // unit of suppression — is the job, matching the email, which asks
  // about every uncovered vehicle at once rather than one per truck.
  const liveAssignment: Prisma.BookingAssignmentWhereInput = {
    status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
    startDate: { gte: utcMidnight(today), lte: utcMidnight(through) },
    driverAssignments: { none: { status: { not: 'CANCELLED' } } },
  }

  const candidates = await prisma.job.findMany({
    where: {
      archivedAt: null,
      returnedAt: null,
      status: { notIn: ['HOLD', 'WRAPPED', 'LOST'] },
      // Asked by nobody, or asked long enough ago that silence is the answer.
      OR: [{ driverRequestSentAt: null }, { driverRequestSentAt: { lt: suppressBefore } }],
      // A real order, not a draft quote.
      orders: { some: { status: { notIn: ['DRAFT', 'CANCELLED'] }, portalSlug: { not: null } } },
      bookings: {
        some: {
          status: { notIn: ['CANCELLED', 'ARCHIVED'] },
          items: { some: { assignments: { some: liveAssignment } } },
        },
      },
    },
    select: {
      id: true, jobCode: true, name: true,
      bookings: {
        where: { status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
        select: { items: { select: { assignments: { where: liveAssignment, select: { startDate: true } } } } },
      },
    },
  })

  const sent: SweepSent[] = []
  const skipped: SweepSkipped[] = []

  for (const job of candidates) {
    const starts = job.bookings
      .flatMap((b) => b.items.flatMap((i) => i.assignments.map((a) => a.startDate)))
      .sort((a, b) => a.getTime() - b.getTime())
    const startDate = starts[0]?.toISOString().slice(0, 10) ?? through
    const base = { jobId: job.id, jobCode: job.jobCode, jobName: job.name, startDate }

    try {
      const r = await requestDriverFromClient({ jobId: job.id, dryRun })
      sent.push({
        ...base,
        sentTo: r.sentTo,
        contactName: r.contactName,
        vehicles: r.vehicles,
        emailOk: r.previewOnly ? null : r.emailOk,
        emailError: r.emailError,
      })
    } catch (e) {
      // A DriverRequestError is a legitimate "nothing to ask here" —
      // no contact, no portal order, every unit already covered. Anything
      // else is a bug worth seeing in the Vercel log.
      if (!(e instanceof DriverRequestError)) console.error('[driver-request-sweep]', job.jobCode ?? job.id, e)
      skipped.push({ ...base, reason: e instanceof Error ? e.message : 'Unknown error' })
    }
  }

  return { dryRun, today, through, considered: candidates.length, sent, skipped }
}
