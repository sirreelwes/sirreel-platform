/**
 * "This job is already papered" — one order's signature covering another's.
 *
 * The case (Wes 2026-08-29): a client with a live job books a second order and
 * doesn't attach it themselves. Staff attach it, and the client is then asked
 * to sign a rental agreement they have already signed for that production.
 *
 * ── Why a sibling signature genuinely covers ────────────────────────────────
 * The rental agreement document renders **Job #**, never an order number
 * (ContractDocument's InfoLine "Job #"). It is built from company + job, and
 * its clauses are terms of business, not a description of what shipped. So the
 * signature papers the JOB; SignedAgreement being unique on (orderId,
 * contractType) is a storage decision that predates multi-order jobs.
 *
 * ── What coverage is NOT ────────────────────────────────────────────────────
 * It is not a signature. A covered order has no signer, no timestamp, no IP,
 * no signed PDF of its own, and every surface that renders a signed COPY must
 * keep saying so. Coverage answers exactly one question — "do we still need to
 * ask this client for something?" — and nothing else. That is why it is a
 * nullable FK rather than an AgreementStatus: the 55 inline SIGNED_* checks
 * across the app keep working untouched, and none of them can accidentally
 * start reporting a signature that does not exist.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'

type Db = PrismaClient | Prisma.TransactionClient

/** Statuses that mean the client has actually signed. */
export const SIGNED_STATUSES = ['SIGNED_BASELINE', 'SIGNED_NEGOTIATED', 'SIGNED_OFFLINE'] as const

export interface AgreementCoverage {
  /** The agreement doing the covering. */
  agreementId: string
  /** The order whose signature it is — shown so the client can place it. */
  orderId: string
  orderNumber: string
  jobCode: string | null
  signedAt: Date | null
  signerName: string | null
}

/**
 * The signed agreement on a SIBLING order of the same job, if there is one.
 *
 * Same job AND same company: a job's company can be corrected after a COI
 * mismatch (PATCH /api/jobs/[id]/company moves job + orders together), and a
 * signature made under the previous entity must not silently paper an order
 * booked under the new one — that is the exact failure the re-issue flow
 * exists to fix.
 *
 * Returns null for the order's own signature; an order is not its own cover.
 */
export async function findJobCoverage(
  orderId: string,
  contractType: 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT' = 'RENTAL_AGREEMENT',
  db: Db = defaultPrisma,
): Promise<AgreementCoverage | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { jobId: true, companyId: true },
  })
  if (!order?.jobId) return null

  const sibling = await db.signedAgreement.findFirst({
    where: {
      contractType,
      status: { in: [...SIGNED_STATUSES] },
      orderId: { not: orderId },
      order: { jobId: order.jobId, companyId: order.companyId },
    },
    // Oldest signature wins: it is the one that papered the job, and it keeps
    // the answer stable as more orders join rather than hopping to whichever
    // was signed most recently.
    orderBy: { signedAt: 'asc' },
    select: {
      id: true,
      signedAt: true,
      signerName: true,
      order: { select: { id: true, orderNumber: true, job: { select: { jobCode: true } } } },
    },
  })
  if (!sibling) return null

  return {
    agreementId: sibling.id,
    orderId: sibling.order.id,
    orderNumber: sibling.order.orderNumber,
    jobCode: sibling.order.job?.jobCode ?? null,
    signedAt: sibling.signedAt,
    signerName: sibling.signerName,
  }
}

/**
 * Record coverage on an order's own agreement row, so reads don't have to
 * re-derive it. Idempotent, and never overwrites a real signature — an order
 * that has since been signed in its own right keeps that and drops the
 * pointer, because its own signature is the better answer.
 */
export async function applyJobCoverage(
  orderId: string,
  contractType: 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT' = 'RENTAL_AGREEMENT',
  db: Db = defaultPrisma,
): Promise<AgreementCoverage | null> {
  const own = await db.signedAgreement.findUnique({
    where: { orderId_contractType: { orderId, contractType } },
    select: { id: true, status: true, coveredByAgreementId: true },
  })
  if (!own) return null
  if ((SIGNED_STATUSES as readonly string[]).includes(own.status)) {
    if (own.coveredByAgreementId) {
      await db.signedAgreement.update({ where: { id: own.id }, data: { coveredByAgreementId: null } })
    }
    return null
  }

  const coverage = await findJobCoverage(orderId, contractType, db)
  if (!coverage) {
    if (own.coveredByAgreementId) {
      await db.signedAgreement.update({ where: { id: own.id }, data: { coveredByAgreementId: null } })
    }
    return null
  }
  if (own.coveredByAgreementId !== coverage.agreementId) {
    await db.signedAgreement.update({
      where: { id: own.id },
      data: { coveredByAgreementId: coverage.agreementId },
    })
  }
  return coverage
}

/** Client-facing sentence for a covered row. */
export function coverageSentence(c: AgreementCoverage): string {
  const when = c.signedAt
    ? c.signedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null
  const who = c.signerName ? ` by ${c.signerName}` : ''
  const where = c.jobCode ? ` for ${c.jobCode}` : ' for this job'
  return when
    ? `Covered by the agreement signed${where} on ${when}${who}. Nothing further needed for this order.`
    : `Covered by the agreement already signed${where}. Nothing further needed for this order.`
}
