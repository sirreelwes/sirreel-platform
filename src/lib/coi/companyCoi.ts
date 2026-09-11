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
import { evaluateInsuredMatch } from '@/lib/coi/insuredMatch'
import { coiDocumentKind } from '@/lib/coi/coverageKind'

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
  // The scope the sign-off was made under. Carried especially matters here:
  // an account certificate approved on a gear-only job spreads to every
  // sibling job, including ones that DO rent a truck (lib/coi/coiState).
  decidedWithVehicles: true,
  createdAt: true,
} as const

export type ResolvedCoi = Prisma.CoiCheckGetPayload<{ select: typeof COI_SELECT }>

/**
 * How many of a job's newest certificates a caller loads, so the pick can
 * step past a workers' comp certificate to the one that insures the rental.
 */
export const OWN_COI_TAKE = 10

/**
 * The newest FULL certificate in a newest-first list — never a workers' comp
 * certificate on its own.
 *
 * Wes 2026-09-11: "MNX has submitted one for work comp and one for general
 * liability." Every surface took the job's NEWEST certificate, so the
 * workers' comp one — uploaded last — governed SR-JOB-0333 in place of the
 * approved general liability certificates beside it. Workers' comp insures
 * the production's crew; it says nothing about the truck. A row with no AI
 * review counts as a full certificate (lib/coi/coverageKind — never mislabel
 * real insurance as missing).
 */
export function newestFullCoi<T extends { aiResponse?: unknown }>(newestFirst: T[]): T | null {
  return newestFirst.find((c) => coiDocumentKind(c.aiResponse) === 'COI') ?? null
}

/** Drop the AI review a pick needed before the row goes anywhere else. */
export function withoutAiResponse<T extends { aiResponse?: unknown }>(row: T): Omit<T, 'aiResponse'> {
  const { aiResponse: _ai, ...rest } = row
  return rest
}

export interface JobCoiResolution {
  coi: ResolvedCoi
  /** 'JOB' — uploaded against this job. 'COMPANY' — the account's certificate
   *  on file, carried forward. */
  source: 'JOB' | 'COMPANY'
  /** Set when a carried-forward policy lapses BEFORE the rental ends. The
   *  certificate is still shown — it covers part of the job — but this names
   *  the date it stops, so nobody reads it as clean coverage. */
  expiresDuringRental: Date | null
  /** True when the account's certificate is on file but nobody has signed it
   *  off yet (rule 1 above). Only ever set for callers that OPTED IN via
   *  `includeAwaitingReview` — staff surfaces that can act on it. Never
   *  coverage: rollupCoiState reads such a row as PENDING, not VERIFIED. */
  awaitingReview?: boolean
}

/** What `pickCarriedCoi` needs to know about a certificate. */
export interface CarryCandidate {
  humanDecision: string
  policyExpiryDate: Date | null
  namedInsured?: string | null
  /** The stored AI review — lets the pick skip a workers' comp certificate.
   *  A caller that does not select it gets every row treated as a full
   *  certificate, so SELECT IT. */
  aiResponse?: unknown
}

export interface CarriedPick<T extends CarryCandidate> {
  coi: T
  awaitingReview: boolean
  expiresDuringRental: Date | null
}

/**
 * Which of an account's certificates carries forward to a job running
 * `start`..`end`. PURE — the /jobs list, the readiness batch and the job
 * detail all pick through here so a tile cannot disagree with the page it
 * opens onto. `npm run test:coi-carry`.
 *
 *   1. APPROVED first, always: one spanning the whole rental, else one that
 *      at least covers the start (returned with the lapse date named).
 *   2. Only when asked (`includeAwaitingReview`) and nothing is approved:
 *      a certificate still waiting on a person — PENDING or COUNTERED. It
 *      is NOT coverage; it is "on file, somebody has to look", and the
 *      caller renders it that way with the review button beside it.
 *      Wes, 2026-09-11: Echobend's harvested annual certificate had sat
 *      PENDING since 09-02, so every Echobend tile said "COI missing"
 *      about a document HQ was holding.
 *
 * Among unreviewed certificates the one that INSURES THIS COMPANY wins
 * over a longer-dated one for somebody else: the email harvest files by
 * client domain, and a producer's other production company can land in
 * the same account (Echobend's file held a CMP Film & Design certificate).
 * Carrying that one forward would put a mismatch flag on every job.
 */
export function pickCarriedCoi<T extends CarryCandidate>(
  certs: T[],
  start: Date,
  end: Date,
  opts: { includeAwaitingReview?: boolean; companyName?: string | null } = {},
): CarriedPick<T> | null {
  const dated = certs
    // Workers' comp on its own is never the certificate a rental carries.
    .filter((c) => coiDocumentKind(c.aiResponse) === 'COI')
    .filter((c) => c.policyExpiryDate instanceof Date && !isNaN(c.policyExpiryDate.getTime()))
    .sort((a, b) => b.policyExpiryDate!.getTime() - a.policyExpiryDate!.getTime())

  const choose = (pool: T[]): { coi: T; expiresDuringRental: Date | null } | null => {
    const full = pool.find((c) => c.policyExpiryDate!.getTime() >= end.getTime())
    if (full) return { coi: full, expiresDuringRental: null }
    const partial = pool.find((c) => c.policyExpiryDate!.getTime() >= start.getTime())
    if (partial) return { coi: partial, expiresDuringRental: partial.policyExpiryDate }
    return null
  }

  const approved = choose(dated.filter((c) => c.humanDecision === 'APPROVED'))
  if (approved) return { ...approved, awaitingReview: false }
  if (!opts.includeAwaitingReview) return null

  const unreviewed = dated.filter((c) => c.humanDecision === 'PENDING' || c.humanDecision === 'COUNTERED')
  if (unreviewed.length === 0) return null
  // 0 = insures this company · 1 = cannot tell · 2 = insures somebody else.
  const rank = (c: T): 0 | 1 | 2 => {
    const v = evaluateInsuredMatch(c.namedInsured, [opts.companyName]).verdict
    return v === 'MATCH' || v === 'CLOSE' ? 0 : v === 'MISMATCH' ? 2 : 1
  }
  for (const tier of [0, 1, 2] as const) {
    const pick = choose(unreviewed.filter((c) => rank(c) === tier))
    if (pick) return { ...pick, awaitingReview: true }
  }
  return null
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
  const rows = await db.coiCheck.findMany({
    where: {
      companyId,
      deletedAt: null,
      humanDecision: 'APPROVED',
      policyExpiryDate: { gte: mustCoverThrough },
    },
    orderBy: [{ policyExpiryDate: 'desc' }, { createdAt: 'desc' }],
    take: OWN_COI_TAKE,
    select: { ...COI_SELECT, aiResponse: true },
  })
  const pick = newestFullCoi(rows)
  return pick ? withoutAiResponse(pick) : null
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
  opts: {
    /** Staff surfaces only. Falls back to the account's UNREVIEWED
     *  certificate (flagged `awaitingReview`) when nothing is approved, so
     *  the reviewer sees the document instead of "Missing". Client-facing
     *  and gating callers never pass this — rule 1 holds for them. */
    includeAwaitingReview?: boolean
  } = {},
): Promise<JobCoiResolution | null> {
  // The job's newest FULL certificate — a workers' comp one on its own never
  // governs, and never stops the account's certificate standing in.
  const own = newestFullCoi(
    await db.coiCheck.findMany({
      where: { jobId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: OWN_COI_TAKE,
      select: { ...COI_SELECT, aiResponse: true },
    }),
  )
  if (own) return { coi: withoutAiResponse(own), source: 'JOB', expiresDuringRental: null }

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

  if (opts.includeAwaitingReview) {
    const unreviewed = await db.coiCheck.findMany({
      where: {
        companyId: window.companyId,
        deletedAt: null,
        humanDecision: { in: ['PENDING', 'COUNTERED'] },
        policyExpiryDate: { gte: start },
      },
      orderBy: [{ policyExpiryDate: 'desc' }, { createdAt: 'desc' }],
      select: { ...COI_SELECT, aiResponse: true, company: { select: { name: true } } },
    })
    const pick = pickCarriedCoi(unreviewed, start, end, {
      includeAwaitingReview: true,
      companyName: unreviewed[0]?.company?.name ?? null,
    })
    if (pick) {
      const { company: _company, aiResponse: _ai, ...coi } = pick.coi
      return { coi, source: 'COMPANY', expiresDuringRental: pick.expiresDuringRental, awaitingReview: true }
    }
  }

  return null
}

/** How a carried-forward certificate is described to staff and clients. */
export function coiSourceSentence(r: JobCoiResolution, companyName?: string | null): string {
  if (r.source === 'JOB') return ''
  const who = companyName ? `${companyName}'s` : 'your'
  if (r.awaitingReview) {
    return `${who[0].toUpperCase()}${who.slice(1)} certificate of insurance is on file but nobody at HQ has reviewed it yet. Approve it and it covers this job.`
  }
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
