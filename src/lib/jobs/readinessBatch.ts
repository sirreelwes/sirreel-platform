/**
 * Batch readiness — the five-check "can this job go out" answer for a SET
 * of job ids, in a handful of queries.
 *
 * Why it exists: /api/jobs computes readiness inline while it builds the
 * jobs list, and that shape (one 300-row page of fully-hydrated jobs) is
 * useless to anyone else. The gantt needs the same verdict keyed by jobId
 * for the bookings on screen, and re-deriving it there is exactly how
 * surfaces drift apart — see the header of ./readiness.ts. So the INPUT
 * gathering moves here and both callers end at the same computeReadiness.
 *
 * Every rule below is lifted verbatim from the jobs-list rollup, including
 * the ones that look like edge cases and are not:
 *   · annual addenda cover a job outright (61 live accounts), and an
 *     expired master reads as unsigned again
 *   · a company COI carries forward only if it covers the JOB'S dates
 *   · a JobCoiConfirmation of SEPARATE_POLICY pulls that carry-forward off
 *   · the vehicle-scope question is asked only of jobs where a gear-only
 *     sign-off could be wrong, because answering it is expensive
 *   · a card counts from either store (booking paperwork OR company wallet)
 */

import { prisma } from '@/lib/prisma'
import type { AgreementStatus, ContractType } from '@prisma/client'
import { isSignedAgreementStatus } from '@/lib/portal/agreementStatus'
import { rollupCoiState, type CoiRollupState } from '@/lib/coi/coiState'
import { VEHICLE_SCOPE_SELECT, deriveVehicleScope } from '@/lib/coi/vehicleScope'
import { deriveJobDateRange } from '@/lib/jobs/dateRange'
import { companiesWithWalletCards } from '@/lib/payments/jobCardOnFile'
import { computeReadiness, type JobReadiness } from './readiness'
import type { AgreementRollupState } from './listRow'

// SignedAgreement is per-Order. A job with two non-cancelled orders either
// has 0/1/2 rental agreement rows; collapse to one state for the chip:
//   NONE → no rows · DRAFT → all pre-release · SENT → out, none signed ·
//   PARTIAL → some signed (multi-order) · SIGNED → every live order papered
// Lifted out of /api/jobs (was a local function there) so this module and
// the list cannot disagree about what "signed" means. It missed
// SIGNED_OFFLINE once, and a filed agreement read "RENTAL Sent" for weeks.
const PRE_RELEASE_STATES: AgreementStatus[] = ['PORTAL_GENERATED']

export function rollupAgreementState(
  rows: { status: AgreementStatus; coveredByAgreementId?: string | null }[],
  liveOrderCount: number,
): { state: AgreementRollupState; count: number } {
  if (rows.length === 0) return { state: 'NONE', count: 0 }
  // A row papered by a sibling order on the same job is SATISFIED, even
  // though it carries no signature of its own. Without this a second order
  // attached to a papered job pins the chip on PARTIAL forever and the desk
  // chases paperwork that nobody is ever going to send.
  const signed = rows.filter(
    (r) => isSignedAgreementStatus(r.status) || !!r.coveredByAgreementId,
  ).length
  if (signed === rows.length && rows.length >= liveOrderCount) {
    return { state: 'SIGNED', count: signed }
  }
  if (signed > 0) return { state: 'PARTIAL', count: signed }
  if (rows.every((r) => PRE_RELEASE_STATES.includes(r.status))) {
    return { state: 'DRAFT', count: rows.length }
  }
  return { state: 'SENT', count: rows.length }
}

/**
 * Readiness for each of `jobIds`, keyed by job id. Ids with no Job row are
 * simply absent from the map — callers render nothing rather than a false
 * "0 of 5". Empty input short-circuits to an empty map (no queries).
 */
export async function readinessForJobs(
  jobIds: string[],
): Promise<Map<string, JobReadiness>> {
  const ids = [...new Set(jobIds.filter(Boolean))]
  const out = new Map<string, JobReadiness>()
  if (ids.length === 0) return out

  const jobs = await prisma.job.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      companyId: true,
      orders: {
        select: {
          status: true,
          startDate: true,
          endDate: true,
          signedAgreements: {
            select: { contractType: true, status: true, coveredByAgreementId: true },
          },
        },
      },
      coiChecks: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          humanDecision: true,
          policyExpiryDate: true,
          coverageVerified: true,
          decidedWithVehicles: true,
        },
      },
      agreementAddenda: {
        where: { deletedAt: null },
        select: {
          companyAgreement: { select: { contractType: true, isAnnual: true, expiryDate: true } },
        },
      },
      bookings: {
        select: {
          startDate: true,
          endDate: true,
          status: true,
          items: {
            select: {
              status: true,
              assignments: { select: { status: true, _count: { select: { driverAssignments: true } } } },
            },
          },
          paperworkRequests: {
            where: { ccCardNumberEncrypted: { not: null } },
            take: 1,
            select: { id: true },
          },
          // Any request at all = the card link went out. Only the WORDS
          // depend on it (computeReadiness.cardRequested).
          _count: { select: { paperworkRequests: true } },
        },
      },
    },
  })
  if (jobs.length === 0) return out

  // Annual COIs carry forward: APPROVED only, must cover the JOB'S dates,
  // no expiry date = no carry-forward. Only consulted for jobs with no
  // certificate of their own.
  const companyIdsNeedingCoi = [
    ...new Set(jobs.filter((j) => j.coiChecks.length === 0 && j.companyId).map((j) => j.companyId as string)),
  ]

  // Three independent follow-ups, issued together. In series this helper
  // cost ~1s for a 140-job window and the gantt waits on it.
  const [walletCardCompanies, companyCois, separatePolicyRows] = await Promise.all([
    // A card keyed in from a signed off-portal authorization lives on the
    // COMPANY (CompanyCard), not on a booking's paperwork row, so the check
    // has to ask both stores (lib/payments/jobCardOnFile).
    companiesWithWalletCards(jobs.map((j) => j.companyId)),
    prisma.coiCheck.findMany({
      where: {
        companyId: { in: companyIdsNeedingCoi },
        deletedAt: null,
        humanDecision: 'APPROVED',
        policyExpiryDate: { not: null },
      },
      orderBy: [{ policyExpiryDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        companyId: true,
        humanDecision: true,
        policyExpiryDate: true,
        coverageVerified: true,
        decidedWithVehicles: true,
      },
    }),
    // …unless the production told us THIS job runs on its own policy. That
    // is the one answer that stops the account cert standing in — carrying
    // it anyway would show the tile insured while the certificate we
    // actually need is still outstanding.
    prisma.jobCoiConfirmation.findMany({
      where: { jobId: { in: jobs.map((j) => j.id) }, decision: 'SEPARATE_POLICY' },
      select: { jobId: true },
    }),
  ])
  const separatePolicyJobIds = new Set(separatePolicyRows.map((r) => r.jobId))
  const companyCoisByCompany = new Map<string, typeof companyCois>()
  for (const c of companyCois) {
    if (!c.companyId) continue
    const arr = companyCoisByCompany.get(c.companyId) ?? []
    arr.push(c)
    companyCoisByCompany.set(c.companyId, arr)
  }

  // Does the job rent a vehicle? Asked only of the jobs where the answer can
  // change a verdict — a certificate signed off gear-only.
  const scopeCandidateIds = jobs
    .filter((j) => {
      const own = j.coiChecks[0]
      if (own) return own.decidedWithVehicles === false
      if (!j.companyId) return false
      return (companyCoisByCompany.get(j.companyId) ?? []).some((c) => c.decidedWithVehicles === false)
    })
    .map((j) => j.id)
  const jobHasVehicles = new Map<string, boolean>()
  if (scopeCandidateIds.length) {
    const scoped = await prisma.job.findMany({
      where: { id: { in: scopeCandidateIds } },
      select: { id: true, ...VEHICLE_SCOPE_SELECT },
    })
    for (const j of scoped) jobHasVehicles.set(j.id, deriveVehicleScope(j).hasVehicles === true)
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
      ? ({ state: 'SIGNED' } as const)
      : rollupAgreementState(
          allAgreements.filter((a) => a.contractType === 'RENTAL_AGREEMENT'),
          liveOrders.length,
        )
    const stageExists = allAgreements.some((a) => a.contractType === 'STAGE_CONTRACT')
    const stage = coveredBy('STAGE_CONTRACT')
      ? ({ state: 'SIGNED' } as const)
      : stageExists
        ? rollupAgreementState(
            allAgreements.filter((a) => a.contractType === 'STAGE_CONTRACT'),
            liveOrders.length,
          )
        : null

    let coi: { state: CoiRollupState } = { state: 'NONE' }
    const hasVehicles = jobHasVehicles.has(j.id) ? jobHasVehicles.get(j.id)! : null
    if (j.coiChecks[0]) {
      coi = rollupCoiState({ ...j.coiChecks[0], jobHasVehicles: hasVehicles })
    } else if (j.companyId && companyCoisByCompany.has(j.companyId) && !separatePolicyJobIds.has(j.id)) {
      // Newest-expiry first (the query's order), so the first cert that
      // covers the whole window governs; failing that, the first that
      // covers the start.
      const range = deriveJobDateRange(j.orders, j.bookings)
      const start = range.start ?? new Date()
      const end = range.end ?? start
      const certs = companyCoisByCompany.get(j.companyId)!
      const covering =
        certs.find((c) => c.policyExpiryDate && c.policyExpiryDate >= end) ??
        certs.find((c) => c.policyExpiryDate && c.policyExpiryDate >= start)
      if (covering) coi = rollupCoiState({ ...covering, jobHasVehicles: hasVehicles })
    }

    // A cancelled hold never went out and has nothing to bring back — it
    // must not contribute gear or drivers to the count.
    const liveBookings = j.bookings.filter((b) => b.status !== 'CANCELLED')
    const liveItems = liveBookings.flatMap((b) =>
      b.items.filter((it) => it.status === 'REQUESTED' || it.status === 'ASSIGNED'),
    )
    const activeAssignments = liveItems.flatMap((it) =>
      it.assignments.filter((a) => a.status === 'ASSIGNED' || a.status === 'CHECKED_OUT'),
    )

    out.set(
      j.id,
      computeReadiness({
        coi: coi.state,
        rental: rental.state,
        stage: stage?.state ?? null,
        cardOnFile:
          liveBookings.some((b) => b.paperworkRequests.length > 0) ||
          (!!j.companyId && walletCardCompanies.has(j.companyId)),
        cardRequested: liveBookings.some((b) => b._count.paperworkRequests > 0),
        gear: {
          total: liveItems.length,
          assigned: liveItems.filter((it) => it.status === 'ASSIGNED').length,
        },
        drivers: {
          units: activeAssignments.length,
          named: activeAssignments.filter((a) => a._count.driverAssignments > 0).length,
        },
      }),
    )
  }

  return out
}
