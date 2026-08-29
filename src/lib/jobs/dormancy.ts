/**
 * What makes a job dormant, in one place.
 *
 * Shared by the manual sweep (scripts/archive-dormant-jobs.ts) and the
 * weekly cron (/api/cron/archive-dormant-jobs). It has to be one
 * definition: if the two drifted, the cron would archive jobs the script
 * says are live, unattended, at 4am on a Monday.
 *
 * ── Dormancy is NOT a date cut ─────────────────────────────────────
 *
 * Wes, 2026-08-29: "Anything older than 30 days is unnecessary to be on
 * the main access page." Implemented as staleness AND deadness, never
 * age alone. Measured the day this was written: of 52 jobs with no
 * activity in 30 days, FOUR were still live — "Extended Stay" and
 * "Desigual x DL #2603" both had FUTURE DATES, two more carried open
 * orders. An age-based rule would have hidden real upcoming rentals,
 * which is a far worse outcome than a cluttered list.
 *
 * So all four must hold:
 *   1. No activity in STALE_DAYS — newest of Job.updatedAt and every
 *      order's updatedAt / quoteSentAt.
 *   2. No future dates on the job, its orders, or its live bookings.
 *   3. No order outside CANCELLED / CLOSED.
 *   4. No non-void invoice carrying a balance.
 *
 * Any one of those keeps the job on the main page regardless of age.
 */

import { prisma } from '@/lib/prisma'

export const STALE_DAYS = 30
const DAY = 86_400_000

/**
 * Refuse to archive more than this in one unattended run.
 *
 * A guard against a change in meaning rather than a change in the data.
 * If a migration ever nulls a date column or a status enum shifts, every
 * job could look dormant at once, and a cron with no ceiling would clear
 * the entire board before anyone noticed. The manual script can exceed
 * this deliberately; the cron cannot.
 */
export const CRON_MAX_PER_RUN = 60

/** The shape the predicate needs. Kept narrow so callers select little. */
export const DORMANCY_SELECT = {
  id: true,
  jobCode: true,
  name: true,
  updatedAt: true,
  startDate: true,
  endDate: true,
  orders: {
    select: {
      status: true,
      updatedAt: true,
      quoteSentAt: true,
      startDate: true,
      endDate: true,
      invoices: { select: { balanceDue: true, status: true } },
    },
  },
  bookings: { select: { status: true, startDate: true, endDate: true } },
} as const

export interface DormancyCandidate {
  id: string
  jobCode: string
  name: string
  updatedAt: Date
  startDate: Date | null
  endDate: Date | null
  orders: {
    status: string
    updatedAt: Date
    quoteSentAt: Date | null
    startDate: Date | null
    endDate: Date | null
    invoices: { balanceDue: unknown; status: string }[]
  }[]
  bookings: { status: string; startDate: Date | null; endDate: Date | null }[]
}

/** Newest of the job row and everything on its orders. */
export function lastActivityAt(j: DormancyCandidate): Date {
  return [
    j.updatedAt,
    ...j.orders.flatMap((o) => [o.updatedAt, o.quoteSentAt].filter(Boolean) as Date[]),
  ].reduce((max, d) => (d > max ? d : max), j.updatedAt)
}

export function hasFutureDate(j: DormancyCandidate, today: Date): boolean {
  const dates = [
    j.startDate,
    j.endDate,
    ...j.orders.flatMap((o) => [o.startDate, o.endDate]),
    ...j.bookings.filter((b) => b.status !== 'CANCELLED').flatMap((b) => [b.startDate, b.endDate]),
  ].filter(Boolean) as Date[]
  return dates.some((d) => d >= today)
}

export function hasOpenOrder(j: DormancyCandidate): boolean {
  return j.orders.some((o) => o.status !== 'CANCELLED' && o.status !== 'CLOSED')
}

export function owesMoney(j: DormancyCandidate): boolean {
  return j.orders.some((o) =>
    o.invoices.some((inv) => Number(inv.balanceDue ?? 0) > 0 && inv.status !== 'VOID'),
  )
}

export type KeepReason = 'recent-activity' | 'future-dates' | 'open-order' | 'owes-money'

/** Why this job stays on the main page, or null when it is dormant. */
export function keepReason(
  j: DormancyCandidate,
  now: Date = new Date(),
  staleDays: number = STALE_DAYS,
): KeepReason | null {
  const cutoff = new Date(now.getTime() - staleDays * DAY)
  const today = new Date(now.toISOString().slice(0, 10))
  if (lastActivityAt(j) >= cutoff) return 'recent-activity'
  if (hasFutureDate(j, today)) return 'future-dates'
  if (hasOpenOrder(j)) return 'open-order'
  if (owesMoney(j)) return 'owes-money'
  return null
}

export interface DormancyScan {
  total: number
  dormant: { id: string; jobCode: string; name: string; lastActivity: string }[]
  kept: Record<KeepReason, number>
}

/** Scan every non-archived job. Reads only; never writes. */
export async function scanDormantJobs(
  now: Date = new Date(),
  staleDays: number = STALE_DAYS,
): Promise<DormancyScan> {
  const jobs = (await prisma.job.findMany({
    where: { archivedAt: null },
    select: DORMANCY_SELECT,
  })) as unknown as DormancyCandidate[]

  const kept: Record<KeepReason, number> = {
    'recent-activity': 0, 'future-dates': 0, 'open-order': 0, 'owes-money': 0,
  }
  const dormant: DormancyScan['dormant'] = []

  for (const j of jobs) {
    const reason = keepReason(j, now, staleDays)
    if (reason) { kept[reason] += 1; continue }
    dormant.push({
      id: j.id,
      jobCode: j.jobCode,
      name: j.name,
      lastActivity: lastActivityAt(j).toISOString().slice(0, 10),
    })
  }
  return { total: jobs.length, dormant, kept }
}
