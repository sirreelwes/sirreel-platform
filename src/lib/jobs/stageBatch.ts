/**
 * Batch job stage — deriveJobStage's inputs for a SET of job ids, in a
 * handful of lean queries, keyed by job id.
 *
 * Why a separate gatherer from readinessForJobs: that one hydrates every
 * item, assignment and driver on every booking (the five checks need
 * them) and costs ~2s for a 150-job gantt window, measured 2026-09-10.
 * The stage only needs to know what has GONE OUT — a few flags per job —
 * and the reservations board paints its bars in the stage's color, so
 * the color cannot wait on the decoration. This select is the smallest
 * that answers the question.
 *
 * The rules are the readiness batch's, applied to the same rollups:
 *   · annual addenda cover a job outright; an expired master does not
 *   · a company COI carries forward only if it covers the JOB'S dates,
 *     and not when the production said THIS job runs on its own policy
 *   · a card counts from either store (booking paperwork OR company wallet)
 *
 * /api/jobs derives the stage inline from the identical rollup states it
 * already computes (it has all of this loaded); this gatherer serves the
 * surfaces that don't — /api/timeline-native and the job detail route.
 */

import { prisma } from '@/lib/prisma'
import { newestFullCoi, OWN_COI_TAKE } from '@/lib/coi/companyCoi'
import { coiDocumentKind } from '@/lib/coi/coverageKind'
import type { ContractType } from '@prisma/client'
import { rollupAgreementState } from './readinessBatch'
import { deriveJobDateRange } from './dateRange'
import { companiesWithWalletCards } from '@/lib/payments/jobCardOnFile'
import type { CoiRollupState } from './listRow'
import { deriveJobStage, WAREHOUSE_DEPARTMENTS, type JobStage } from './stage'

export async function stageForJobs(jobIds: string[]): Promise<Map<string, JobStage>> {
  const ids = [...new Set(jobIds.filter(Boolean))]
  const out = new Map<string, JobStage>()
  if (ids.length === 0) return out

  const jobs = await prisma.job.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      status: true,
      companyId: true,
      fromInquiry: { select: { respondedAt: true } },
      orders: {
        select: {
          status: true,
          quoteSentAt: true,
          startDate: true,
          endDate: true,
          signedAgreements: {
            select: { contractType: true, status: true, coveredByAgreementId: true },
          },
          _count: { select: { lineItems: { where: { department: { in: WAREHOUSE_DEPARTMENTS } } } } },
        },
      },
      // Several + the review, so a workers' comp upload on its own does not
      // count as the job's certificate (lib/coi/companyCoi.newestFullCoi).
      coiChecks: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: OWN_COI_TAKE,
        select: { id: true, aiResponse: true },
      },
      agreementAddenda: {
        where: { deletedAt: null },
        select: { companyAgreement: { select: { contractType: true, isAnnual: true, expiryDate: true } } },
      },
      bookings: {
        select: {
          status: true,
          startDate: true,
          endDate: true,
          paperworkRequests: { where: { ccCardNumberEncrypted: { not: null } }, take: 1, select: { id: true } },
          _count: { select: { paperworkRequests: true } },
        },
      },
    },
  })
  if (jobs.length === 0) return out

  const companyIdsNeedingCoi = [
    ...new Set(jobs.filter((j) => !newestFullCoi(j.coiChecks) && j.companyId).map((j) => j.companyId as string)),
  ]
  const [walletCardCompanies, companyCois, separatePolicyRows] = await Promise.all([
    companiesWithWalletCards(jobs.map((j) => j.companyId)),
    companyIdsNeedingCoi.length
      ? prisma.coiCheck.findMany({
          where: {
            companyId: { in: companyIdsNeedingCoi },
            deletedAt: null,
            humanDecision: 'APPROVED',
            policyExpiryDate: { not: null },
          },
          select: { companyId: true, policyExpiryDate: true, aiResponse: true },
        })
      : Promise.resolve([] as { companyId: string | null; policyExpiryDate: Date | null; aiResponse: unknown }[]),
    prisma.jobCoiConfirmation.findMany({
      where: { jobId: { in: jobs.map((j) => j.id) }, decision: 'SEPARATE_POLICY' },
      select: { jobId: true },
    }),
  ])
  const separatePolicyJobIds = new Set(separatePolicyRows.map((r) => r.jobId))
  const coisByCompany = new Map<string, Date[]>()
  for (const c of companyCois) {
    if (!c.companyId || !c.policyExpiryDate) continue
    // Workers' comp on its own never carries to a job.
    if (coiDocumentKind(c.aiResponse) === 'WORKERS_COMP') continue
    const arr = coisByCompany.get(c.companyId) ?? []
    arr.push(c.policyExpiryDate)
    coisByCompany.set(c.companyId, arr)
  }

  const now = new Date()
  for (const j of jobs) {
    const liveOrders = j.orders.filter((o) => o.status !== 'CANCELLED')
    const allAgreements = liveOrders.flatMap((o) => o.signedAgreements)
    const coveredBy = (type: ContractType) =>
      j.agreementAddenda.some(
        (a) =>
          a.companyAgreement.contractType === type &&
          !(a.companyAgreement.isAnnual && a.companyAgreement.expiryDate && a.companyAgreement.expiryDate < now),
      )
    const rental = coveredBy('RENTAL_AGREEMENT')
      ? 'SIGNED'
      : rollupAgreementState(
          allAgreements.filter((a) => a.contractType === 'RENTAL_AGREEMENT'),
          liveOrders.length,
        ).state
    const stageExists = allAgreements.some((a) => a.contractType === 'STAGE_CONTRACT')
    const stage = coveredBy('STAGE_CONTRACT')
      ? 'SIGNED'
      : stageExists
        ? rollupAgreementState(
            allAgreements.filter((a) => a.contractType === 'STAGE_CONTRACT'),
            liveOrders.length,
          ).state
        : null

    // For the stage only EXISTENCE matters — a certificate that reached us
    // means the request went out — so any non-NONE rollup value will do.
    let coi: CoiRollupState = 'NONE'
    if (newestFullCoi(j.coiChecks)) {
      coi = 'PENDING'
    } else if (j.companyId && coisByCompany.has(j.companyId) && !separatePolicyJobIds.has(j.id)) {
      const range = deriveJobDateRange(j.orders, j.bookings)
      const start = range.start ?? new Date()
      const end = range.end ?? start
      const expiries = coisByCompany.get(j.companyId)!
      if (expiries.some((d) => d >= end) || expiries.some((d) => d >= start)) coi = 'VERIFIED'
    }

    const liveBookings = j.bookings.filter((b) => b.status !== 'CANCELLED')
    out.set(
      j.id,
      deriveJobStage({
        jobStatus: j.status,
        inquiry: j.fromInquiry ? { respondedAt: j.fromInquiry.respondedAt } : null,
        liveOrders: liveOrders.map((o) => ({
          status: o.status,
          quoteSentAt: o.quoteSentAt,
          warehouseLines: o._count.lineItems,
        })),
        liveBookings: liveBookings.map((b) => ({ status: b.status })),
        allBookingsCancelled: j.bookings.length > 0 && liveBookings.length === 0,
        agreement: rental,
        stageAgreement: stage,
        coi,
        cardOnFile:
          liveBookings.some((b) => b.paperworkRequests.length > 0) ||
          (!!j.companyId && walletCardCompanies.has(j.companyId)),
        cardRequested: liveBookings.some((b) => b._count.paperworkRequests > 0),
      }),
    )
  }
  return out
}
