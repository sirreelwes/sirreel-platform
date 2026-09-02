/**
 * "This client signs once a year" — a company's annual master agreement
 * papering every job it books.
 *
 * The case (Wes, 2026-09-01): "I need to set up some companies for Annual
 * Agreements, where they are automatically approved on the rental agreement
 * and only asked to elect or deny LCDW."
 *
 * ── Why an annual master genuinely covers ───────────────────────────────
 * The clauses of the rental agreement are terms of business, not a
 * description of what shipped — which is exactly why the document renders
 * Job # and a rental period and nothing about the gear. An executed annual
 * master IS that signature, given once for the year. Asking an annual
 * account to sign the same terms again per job is asking for a signature
 * they already gave, and the ask is not free: it is the single step that
 * stalls a portal the longest.
 *
 * ── What it is NOT ─────────────────────────────────────────────────────
 * Not a per-order signature. A covered order has no signer, no timestamp,
 * no IP and no signed PDF of its own, and every surface that renders a
 * signed COPY must keep saying so. This answers exactly one question — "do
 * we still need to ask this client to sign?" — the same discipline
 * agreementCoverage.ts keeps for sibling coverage, and for the same reason:
 * the 55 inline SIGNED_* checks across the app keep working untouched, and
 * none of them can start reporting a signature that does not exist.
 *
 * ── Why the flag, and not just "an annual agreement is on file" ─────────
 * CompanyAgreement rows are also filed as a RECORD — last year's master, a
 * superseded one-off, a countersigned copy kept for the file. Treating any
 * of those as a standing instruction to stop asking for signatures would
 * quietly stop asking on the strength of an expired document. Coverage
 * requires the explicit `autoCoverJobs` opt-in AND a current window.
 */
import type { LcdwDecision, Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { SIGNED_STATUSES } from '@/lib/orders/agreementCoverage'

type Db = PrismaClient | Prisma.TransactionClient

export interface AnnualCoverage {
  companyAgreementId: string
  companyId: string
  companyName: string | null
  title: string | null
  originalFilename: string
  effectiveDate: Date | null
  expiryDate: Date | null
  signerName: string | null
  signedAt: Date | null
  /// The LCDW answer signed ON the master ("I accept/decline LCDW for all
  /// fleet vehicle rentals"). The default a job's election starts from.
  standingLcdwDecision: LcdwDecision | null
}

/**
 * Is this CompanyAgreement currently covering? Dates are stored as
 * timestamps but mean CALENDAR days, so both ends are inclusive: an
 * agreement that expires 2026-12-31 covers a job booked on 2026-12-31.
 */
export function isCoverageCurrent(
  a: { autoCoverJobs: boolean; deletedAt: Date | null; effectiveDate: Date | null; expiryDate: Date | null },
  now: Date = new Date(),
): boolean {
  if (!a.autoCoverJobs || a.deletedAt) return false
  if (a.effectiveDate && a.effectiveDate.getTime() > now.getTime()) return false
  if (a.expiryDate) {
    // Inclusive of the expiry DAY — end of that calendar date.
    const endOfDay = new Date(a.expiryDate)
    endOfDay.setUTCHours(23, 59, 59, 999)
    if (endOfDay.getTime() < now.getTime()) return false
  }
  return true
}

const COMPANY_AGREEMENT_SELECT = {
  id: true,
  companyId: true,
  title: true,
  originalFilename: true,
  autoCoverJobs: true,
  deletedAt: true,
  isAnnual: true,
  effectiveDate: true,
  expiryDate: true,
  signerName: true,
  signedAt: true,
  standingLcdwDecision: true,
  createdAt: true,
  company: { select: { name: true } },
} as const

/**
 * The auto-covering master on file for a company, if there is one.
 *
 * Newest EFFECTIVE date wins (falling back to filing order), so the moment
 * this year's master is switched on it takes over from last year's — the
 * opposite of the sibling rule, where the oldest signature wins because it
 * is the one that papered the job. Here the newest document is the one the
 * client is actually operating under.
 */
export async function findCompanyAnnualCoverage(
  companyId: string,
  contractType: 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT' = 'RENTAL_AGREEMENT',
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<AnnualCoverage | null> {
  const candidates = await db.companyAgreement.findMany({
    where: { companyId, contractType, deletedAt: null, autoCoverJobs: true },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    select: COMPANY_AGREEMENT_SELECT,
  })
  const hit = candidates.find((a) => isCoverageCurrent(a, now))
  if (!hit) return null

  return {
    companyAgreementId: hit.id,
    companyId: hit.companyId,
    companyName: hit.company?.name ?? null,
    title: hit.title,
    originalFilename: hit.originalFilename,
    effectiveDate: hit.effectiveDate,
    expiryDate: hit.expiryDate,
    signerName: hit.signerName,
    signedAt: hit.signedAt,
    standingLcdwDecision: hit.standingLcdwDecision,
  }
}

/** Same, resolved from an order. */
export async function findAnnualCoverage(
  orderId: string,
  contractType: 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT' = 'RENTAL_AGREEMENT',
  db: Db = defaultPrisma,
): Promise<AnnualCoverage | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { companyId: true },
  })
  if (!order?.companyId) return null
  return findCompanyAnnualCoverage(order.companyId, contractType, db)
}

/**
 * Stamp annual coverage on an order's own agreement row so reads don't
 * re-derive it. Idempotent, and never overrides a real signature — an order
 * signed in its own right keeps that and drops the pointer, because its own
 * signature is the better answer.
 *
 * Self-healing in both directions: if the master expires, is un-flagged, or
 * is deleted, the next call clears the pointer and the client is asked to
 * sign again. That is the correct behaviour — coverage that outlives its
 * document is a job papered by nothing.
 */
export async function applyAnnualCoverage(
  orderId: string,
  contractType: 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT' = 'RENTAL_AGREEMENT',
  db: Db = defaultPrisma,
): Promise<AnnualCoverage | null> {
  const own = await db.signedAgreement.findUnique({
    where: { orderId_contractType: { orderId, contractType } },
    select: { id: true, status: true, coveredByCompanyAgreementId: true },
  })
  if (!own) return null

  const clear = async () => {
    if (own.coveredByCompanyAgreementId) {
      await db.signedAgreement.update({
        where: { id: own.id },
        data: { coveredByCompanyAgreementId: null },
      })
    }
  }

  if ((SIGNED_STATUSES as readonly string[]).includes(own.status)) {
    await clear()
    return null
  }

  const coverage = await findAnnualCoverage(orderId, contractType, db)
  if (!coverage) {
    await clear()
    return null
  }
  if (own.coveredByCompanyAgreementId !== coverage.companyAgreementId) {
    await db.signedAgreement.update({
      where: { id: own.id },
      data: { coveredByCompanyAgreementId: coverage.companyAgreementId },
    })
  }
  return coverage
}

/** How the master is named to a client / on the job page. */
export function annualCoverageTitle(c: AnnualCoverage): string {
  if (c.title) return c.title
  const year = c.effectiveDate ? c.effectiveDate.getUTCFullYear() : null
  return year ? `${year} Annual Rental Agreement` : 'Annual Rental Agreement'
}

/** Client-facing sentence for a covered row. */
export function annualCoverageSentence(c: AnnualCoverage): string {
  const who = c.companyName ? `${c.companyName}'s` : 'your'
  const doc = annualCoverageTitle(c)
  const through = c.expiryDate
    ? `, in effect through ${c.expiryDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
    : ''
  return `Covered by ${who} ${doc}${through}. Nothing to sign for this job — we only need your damage-waiver election below.`
}
