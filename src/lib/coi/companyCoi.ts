/**
 * A company's certificate carrying forward to its jobs.
 *
 * Wes, 2026-09-02: "COIs are often annual documents. For example with Fox
 * Sports and Echobend they are. We need any COI uploaded for that company to
 * be automatically linked to future jobs until the COI expiration."
 *
 * Every read path resolved a job's COI by `jobId` alone, so an annual account
 * that filed one certificate in February looked uninsured on every job after
 * it — and got chased for a document already sitting in HQ. `CoiCheck` has
 * carried a nullable `companyId` all along (all 21 rows have it populated);
 * nothing ever read it.
 *
 * ── Three rules this must not bend ─────────────────────────────────
 *
 * 1. APPROVED only. A PENDING certificate has not been reviewed and a
 *    REJECTED one failed review; carrying either forward would turn "nobody
 *    has checked this" into "this job is insured" across an entire account.
 *    Measured 2026-09-02: exactly half the certificates on file are PENDING.
 *
 * 2. The policy must be in effect for the JOB'S DATES, not for today.
 *    "Future jobs until the COI expiration" is a claim about the rental
 *    window: a certificate expiring Oct 1 does not cover a job running
 *    Sep 28 – Oct 5. Carrying it silently is the quiet wrong answer this
 *    whole module exists to avoid — so a policy that lapses mid-rental is
 *    RETURNED with the gap named, never as clean coverage.
 *
 * 3. No expiry date, no carry-forward. You cannot honour "until the COI
 *    expiration" for a certificate that does not say when it expires. The
 *    job's own certificate is still shown; it just does not spread to
 *    siblings on a date nobody can point to.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { deriveJobDateRange } from '@/lib/jobs/dateRange'

type Db = PrismaClient | Prisma.TransactionClient

export const COI_SELECT = {
  id: true,
  jobId: true,
  companyId: true,
  fileUrl: true,
  originalFilename: true,
  humanDecision: true,
  aiRiskLevel: true,
  namedInsured: true,
  policyExpiryDate: true,
  coverageVerified: true,
  additionalInsured: true,
  createdAt: true,
} as const

export type ResolvedCoi = Prisma.CoiCheckGetPayload<{ select: typeof COI_SELECT }>

export interface JobCoiResolution {
  coi: ResolvedCoi
  /** 'JOB' — uploaded against this job. 'COMPANY' — the account's certificate
   *  on file, carried forward. */
  source: 'JOB' | 'COMPANY'
  /** Set when a carried-forward policy lapses BEFORE the rental ends. The
   *  certificate is still shown — it covers part of the job — but this names
   *  the date it stops, so nobody reads it as clean coverage. */
  expiresDuringRental: Date | null
}

/** The window a job's insurance actually has to span. */
async function jobRentalWindow(jobId: string, db: Db) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      companyId: true,
      orders: { select: { startDate: true, endDate: true, status: true } },
      bookings: { select: { startDate: true, endDate: true, status: true } },
    },
  })
  if (!job) return null
  const range = deriveJobDateRange(job.orders, job.bookings)
  return { companyId: job.companyId, start: range.start, end: range.end }
}

/**
 * The account's certificate on file that covers a given date.
 *
 * Newest EFFECTIVE certificate wins — resolved by expiry, so this year's
 * annual supersedes last year's the moment it is filed, rather than the
 * ordering depending on when somebody got round to uploading it.
 */
export async function findCompanyCoi(
  companyId: string,
  mustCoverThrough: Date,
  db: Db = defaultPrisma,
): Promise<ResolvedCoi | null> {
  return db.coiCheck.findFirst({
    where: {
      companyId,
      deletedAt: null,
      humanDecision: 'APPROVED',
      policyExpiryDate: { gte: mustCoverThrough },
    },
    orderBy: [{ policyExpiryDate: 'desc' }, { createdAt: 'desc' }],
    select: COI_SELECT,
  })
}

/**
 * The certificate that governs a job: its own, else the company's.
 *
 * A job's own upload ALWAYS wins, even when the company has a longer-dated
 * one. Somebody attached that certificate to this job deliberately — often
 * because the production carries its own policy — and overriding it with the
 * account default would quietly substitute a different insurer's document.
 */
export async function resolveJobCoi(
  jobId: string,
  db: Db = defaultPrisma,
): Promise<JobCoiResolution | null> {
  const own = await db.coiCheck.findFirst({
    where: { jobId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: COI_SELECT,
  })
  if (own) return { coi: own, source: 'JOB', expiresDuringRental: null }

  const window = await jobRentalWindow(jobId, db)
  if (!window?.companyId) return null

  // Undated job → today. A job with no schedule has no window to span, and
  // requiring coverage through an unknown date would reject every valid
  // certificate.
  const start = window.start ?? new Date()
  const end = window.end ?? start

  // Try for a policy that spans the WHOLE rental first.
  const full = await findCompanyCoi(window.companyId, end, db)
  if (full) return { coi: full, source: 'COMPANY', expiresDuringRental: null }

  // Then one that at least covers the start — real, partial coverage, and the
  // gap is named rather than hidden. Silence here would read as "no COI on
  // file" for a job that has one for most of its run, and staff would chase a
  // document they already hold instead of chasing the renewal they need.
  const partial = await findCompanyCoi(window.companyId, start, db)
  if (partial) {
    return {
      coi: partial,
      source: 'COMPANY',
      expiresDuringRental: partial.policyExpiryDate ?? null,
    }
  }

  return null
}

/** How a carried-forward certificate is described to staff and clients. */
export function coiSourceSentence(r: JobCoiResolution, companyName?: string | null): string {
  if (r.source === 'JOB') return ''
  const who = companyName ? `${companyName}'s` : 'your'
  const until = r.coi.policyExpiryDate
    ? ` It is in effect through ${r.coi.policyExpiryDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}.`
    : ''
  if (r.expiresDuringRental) {
    const when = r.expiresDuringRental.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
    return `Using ${who} certificate on file, but it expires ${when} — before this rental ends. We'll need the renewal before the last day.`
  }
  return `Using ${who} certificate of insurance already on file.${until}`
}
