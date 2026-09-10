import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isNativeToHq, jobOrigin } from '@/lib/provenance'
import { RW_VOID } from '@/lib/rentalworks/arStatus'
import { getServerSession } from 'next-auth'
import type {
  JobStatus,
  OrderStatus,
  OrderQuoteStatus,
  LineItemDepartment,
  AgreementStatus,
  ContractType,
  ReviewDecision,
  InvoiceStatus,
} from '@prisma/client'
import { derivePipelineColumn, type PipelineColumn } from '@/lib/sales/pipeline'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import { nextJobCode } from '@/lib/jobs/nextJobCode'
import { recomputeMostCommonProductionTypeProfile } from '@/lib/companies/recomputeMostCommonProductionTypeProfile'
import { resolveDataScope, jobScopeWhere } from '@/lib/auth/scope'
import { createJobFromDraft } from '@/lib/jobs/resolveJob'
import { rollupCadence, cadenceDays } from '@/lib/jobs/cadence'
import { liveOrdersForRollup } from '@/lib/jobs/liveOrders'
import { countRedlinesAwaitingAction } from '@/lib/jobs/redlineAlert'
import { computeReadiness } from '@/lib/jobs/readiness'
import { rollupAgreementState } from '@/lib/jobs/readinessBatch'
import { companiesWithWalletCards } from '@/lib/payments/jobCardOnFile'
import { rollupCoiState, type CoiRollupState } from '@/lib/coi/coiState'
import { VEHICLE_SCOPE_SELECT, deriveVehicleScope } from '@/lib/coi/vehicleScope'
import { deriveJobDateRange } from '@/lib/jobs/dateRange'

export const dynamic = 'force-dynamic'

// GET /api/jobs?companyId=xxx&status=ACTIVE&statuses=QUOTED,ACTIVE&agentId=xxx&mine=1&search=foo
//                &include=quoteStatus,departments  (Phase 1 sales pipeline)
//                &orphans=1  (only QUOTED jobs with no sent/durable order)
//                &archived=1 (only archived jobs; default excludes them)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId')
  const status = searchParams.get('status') as JobStatus | null
  const statusesParam = searchParams.get('statuses')
  let agentId = searchParams.get('agentId')
  const mine = searchParams.get('mine') === '1'
  const search = searchParams.get('search')
  const orphans = searchParams.get('orphans') === '1'
  // Archive is a hide, not a delete: the default list excludes
  // archived jobs (which is what the archive confirmation has always
  // promised and this endpoint never did), and `archived=1` is how you
  // go looking for them. Every caller wants the default — the job
  // pickers shouldn't offer an archived job to hang a new order on
  // either.
  const archivedOnly = searchParams.get('archived') === '1'
  const includeParam = searchParams.get('include') || ''
  const includes = new Set(includeParam.split(',').map((s) => s.trim()).filter(Boolean))
  const includeQuoteStatus = includes.has('quoteStatus')
  const includeDepartments = includes.has('departments')

  const statuses = statusesParam
    ? (statusesParam.split(',').filter(Boolean) as JobStatus[])
    : null

  // Phase 6.5 — data scope enforcement. OWN users see only their own
  // jobs regardless of client params. ADMIN / MANAGER always TEAM.
  //
  // The one exception is a SERVER-SIDE caller holding CRON_SECRET. An
  // unauthenticated request resolves to scope OWN with a null userId,
  // which filters to nothing — correct for the public internet, and a
  // silent no-op for a cron, which is worse than an error because it
  // looks like it ran. /api/cron/hq-escalation reads this route rather
  // than re-deriving readiness, so it needs team scope without a
  // session. The secret is server-only and already gates every sibling
  // cron; this widens READ scope on this route and nothing else.
  const cronSecret = process.env.CRON_SECRET
  const isCron =
    !!cronSecret && (req.headers.get('authorization') || '') === `Bearer ${cronSecret}`
  const scope = isCron
    ? ({ userId: null, role: null, scope: 'TEAM' } as const)
    : await resolveDataScope()
  const scopeWhere = jobScopeWhere(scope)

  // Legacy mine=1 still resolves to the session user's id (UI may
  // pass it for self-view), but scope-OWN supersedes it. For TEAM
  // users the mine=1 path is preserved.
  if (mine && !agentId && scope.scope === 'TEAM') {
    if (scope.userId) {
      agentId = scope.userId
    } else {
      return NextResponse.json({ jobs: [] })
    }
  }

  try {
    const jobs = await prisma.job.findMany({
      where: {
        ...scopeWhere,
        ...(archivedOnly ? { archivedAt: { not: null } } : { archivedAt: null }),
        ...(companyId && { companyId }),
        // agentId client-opted filter only honored for TEAM. OWN
        // already constrained by scopeWhere; a divergent agentId
        // param is ignored.
        ...(agentId && scope.scope === 'TEAM' && { agentId }),
        // `orphans=1` overrides the status filter — it's QUOTED + no
        // sent/durable order. "Durable" = any order that has progressed
        // past DRAFT (quoteStatus IN SENT/WON/LOST/EXPIRED). A job with
        // zero orders or only DRAFT orders qualifies.
        ...(orphans
          ? {
              status: 'QUOTED' as JobStatus,
              orders: { none: { quoteStatus: { in: ['SENT', 'WON', 'LOST', 'EXPIRED'] } } },
            }
          : statuses && statuses.length > 0
          ? { status: { in: statuses } }
          : status
          ? { status }
          : {}),
        // Phase 7 Pass A — agent-find-a-gig predicate. Match by
        // job name, jobCode, company name, OR any jobContact's
        // person.firstName/lastName/email. The Person hits go through
        // the jobContacts relation so we don't widen to the entire
        // people table; only contacts attached to this job count.
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { jobCode: { contains: search, mode: 'insensitive' } },
            { company: { name: { contains: search, mode: 'insensitive' } } },
            {
              jobContacts: {
                some: {
                  person: {
                    OR: [
                      { firstName: { contains: search, mode: 'insensitive' } },
                      { lastName: { contains: search, mode: 'insensitive' } },
                      { email: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            },
          ],
        }),
      },
      include: {
        company: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        // Physical-return attribution — RETURNED cards show who marked
        // the job back. returnedAt itself is a Job scalar (spread below).
        returnedBy: { select: { id: true, name: true } },
        jobContacts: {
          include: {
            person: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          },
        },
        orders: {
          select: {
            status: true,
            subtotal: true,
            // An archived order is a duplicate someone has already
            // dismissed — liveOrdersForRollup drops it before any
            // derived state reads it.
            archivedAt: true,
            // Released-fleet badge — the order-linked half of the job's
            // partner units (see the job-level subRentals select above).
            subRentals: { select: { status: true, endDate: true } },
            // Feeds the "Recently touched" sort. Sending a quote updates
            // the ORDER, not the Job — which is exactly why a list
            // ordered on Job.createdAt left a just-quoted job thirty
            // rows down.
            updatedAt: true,
            quoteSentAt: true,
            // Phase 7 cadence rollup — Order grain dates + status drive
            // the operational state (booked / picking up / on rental /
            // returning / returned / invoiced / wrapped) computed live
            // against today/tomorrow.
            startDate: true,
            endDate: true,
            // Blind handoff flags — surface eye-off icons on the Jobs
            // list when ANY order on the job has them set.
            blindPickup: true,
            blindReturn: true,
            // Phase 7 paperwork rollup — minimal SignedAgreement
            // select. Aggregated across the job's non-cancelled orders
            // to compute Rental + Stage paperwork chips for the list.
            signedAgreements: {
              select: { contractType: true, status: true, coveredByAgreementId: true },
            },
            // Phase 7 billing rollup — read the STORED reconciled
            // amountPaid / balanceDue / status columns that
            // reconcileInvoiceTotals (lib/invoices/recordPayment.ts)
            // maintains from CLEARED non-voided payments only.
            // LINCHPIN: we do NOT re-sum Payment rows here — PENDING /
            // SETTLED ACH must not bleed into "paid".
            invoices: {
              select: {
                status: true,
                balanceDue: true,
                total: true,
                dueDate: true,
                // Phase 7 L&D marker (invoice-side path): claims filed
                // against an LD invoice. _count is cheap and avoids
                // hydrating claim rows we don't render.
                _count: { select: { insuranceClaims: true } },
              },
            },
            // Phase 7 L&D marker (booking-side path): every
            // InsuranceClaim has a required bookingId. _count > 0 on
            // either path → red triangle next to the job name.
            booking: {
              select: { _count: { select: { insuranceClaims: true } } },
            },
            // Stage scope marker — drives whether the Stage Contract
            // button renders on the Jobs list. A negotiated stage
            // booking creates this row before any agreement is sent,
            // so it surfaces the slot earlier than the SignedAgreement
            // signal alone would.
            stageBookingTerms: { select: { id: true } },
            ...(includeQuoteStatus ? { quoteStatus: true } : {}),
            ...(includeDepartments
              ? {
                  lineItems: {
                    select: { department: true },
                  },
                }
              : {}),
          },
        },
        // CoiCheck attaches per-Job (jobId FK). Latest non-deleted row
        // wins — agents replace a COI on policy renewal rather than
        // appending. Three fields drive the chip: humanDecision (the
        // SirReel-team verdict), policyExpiryDate (vs today), and
        // coverageVerified (AI's read).
        coiChecks: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            humanDecision: true,
            policyExpiryDate: true,
            coverageVerified: true,
            // The scope the sign-off was made under. A certificate approved
            // for a gear-only job does not cover the truck someone added
            // afterwards (src/lib/coi/coiState.coiScopeGap).
            decidedWithVehicles: true,
          },
        },
        // Job-level agreement coverage — the job attached as an addendum to
        // an on-file (usually annual) master. The detail page has always
        // read this as "On file"; until 2026-09-06 the list read only the
        // per-order signatures, so an annual account's every job showed
        // "Missing: Agreement" on the tile and "On file" one click later.
        agreementAddenda: {
          where: { deletedAt: null },
          select: {
            companyAgreement: {
              select: { contractType: true, isAnnual: true, expiryDate: true },
            },
          },
        },
        _count: { select: { orders: true } },
        // Released-fleet badge (Wes 2026-09-08). Job-linked sub-rentals
        // only here; the order-linked ones come off the orders select
        // below, because a SubRental reaches a job either way.
        subRentals: { select: { status: true, endDate: true } },
        // Board placement inputs — booking envelope dates (fallback when
        // the Job itself is date-less) and the delivery signal. Items /
        // assignments / driver counts + the card flag feed the readiness
        // rollup (src/lib/jobs/readiness.ts).
        bookings: {
          select: {
            startDate: true,
            endDate: true,
            deliveryAddress: true,
            status: true,
            // Provenance — is this booking HQ's or an import? See
            // src/lib/provenance. The list is 83% Planyo, so without
            // this the work HQ owns is invisible in the crowd.
            planyoCartId: true,
            source: true,
            items: {
              select: {
                status: true,
                // Gear summary for the rail tile (Wes 2026-09-06: "more
                // info on the actual tile") — what is on the job, by
                // category, and which units are already on it.
                quantity: true,
                category: { select: { name: true } },
                assignments: {
                  select: {
                    status: true,
                    // The return edge of a checked-out truck — the
                    // cadence rollup reads it (src/lib/jobs/cadence.ts).
                    endDate: true,
                    asset: { select: { unitName: true } },
                    _count: { select: { driverAssignments: true } },
                  },
                },
              },
            },
            // Card on file — same test the job detail route runs
            // (ccCardNumberEncrypted set), collapsed to existence.
            paperworkRequests: {
              where: { ccCardNumberEncrypted: { not: null } },
              take: 1,
              select: { id: true },
            },
            // Any request at all = the card link went out. Only the
            // tile's WORDS depend on it (computeReadiness.cardRequested).
            _count: { select: { paperworkRequests: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      // Headroom above the live-job count so the list never silently
      // truncates. Archiving dormant jobs (scripts/archive-dormant-jobs.ts)
      // is what keeps the number down — 250 live jobs became 202 on
      // 2026-08-29 — and this cap is the backstop, not the mechanism. If
      // it ever binds again, run the sweep rather than raising it: a
      // truncated list gives no sign it was truncated.
      take: 300,
    })

    // A card keyed in from a signed off-portal authorization lives on the
    // COMPANY (CompanyCard), not on a booking's paperwork row — so the chip
    // has to ask both stores or it calls a job a blocker with a live card on
    // the account. One query for the page; see lib/payments/jobCardOnFile.ts.
    const walletCardCompanies = await companiesWithWalletCards(jobs.map((j) => j.companyId))

    // Annual COIs carry forward (Wes 2026-09-02) — the detail route resolves
    // this per job through lib/coi/companyCoi.resolveJobCoi; the list needs
    // the same answer for 250 jobs in one query. Same three rules: APPROVED
    // only, must cover the JOB'S dates (full coverage first, else one that
    // at least covers the start), no expiry date = no carry-forward. Only
    // consulted for jobs with no certificate of their own.
    const companyIdsNeedingCoi = [
      ...new Set(
        jobs.filter((j) => j.coiChecks.length === 0 && j.companyId).map((j) => j.companyId as string),
      ),
    ]
    const companyCois = companyIdsNeedingCoi.length
      ? await prisma.coiCheck.findMany({
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
        })
      : []
    const companyCoisByCompany = new Map<string, typeof companyCois>()
    for (const c of companyCois) {
      if (!c.companyId) continue
      const arr = companyCoisByCompany.get(c.companyId) ?? []
      arr.push(c)
      companyCoisByCompany.set(c.companyId, arr)
    }

    // …unless the production told us THIS job runs on its own policy (Wes,
    // 2026-09-09). That is the one answer that stops the account cert
    // standing in — carrying it anyway would show the tile as insured while
    // the certificate we actually need is still outstanding. Unconfirmed
    // jobs keep their coverage; only an explicit SEPARATE_POLICY opts out.
    const separatePolicyJobIds = new Set(
      (
        await prisma.jobCoiConfirmation.findMany({
          where: { jobId: { in: jobs.map((j) => j.id) }, decision: 'SEPARATE_POLICY' },
          select: { jobId: true },
        })
      ).map((r) => r.jobId),
    )

    // Does the job rent a vehicle? Only asked of the jobs where the answer can
    // change anything — a certificate signed off gear-only. That is a handful
    // of rows, and loading every line item and booking item for 300 jobs to
    // answer it for the other 295 would be a real cost for no verdict.
    const scopeCandidateIds = jobs
      .filter((j) => {
        const own = j.coiChecks[0]
        if (own) return own.decidedWithVehicles === false
        if (!j.companyId) return false
        return (companyCoisByCompany.get(j.companyId) ?? []).some(
          (c) => c.decidedWithVehicles === false,
        )
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

    // Kanban manual placements (side table, presentation-only). One
    // query for the whole page of jobs. PREJOB/OUT only — RETURNED is
    // semantic (Job.returnedAt) now; legacy 'RETURNED' override rows
    // from before the cutover are ignored on read.
    const overrides = await prisma.jobBoardOverride.findMany({
      where: { jobId: { in: jobs.map((j) => j.id) }, phase: { in: ['PREJOB', 'OUT'] } },
      select: { jobId: true, phase: true },
    })
    const overrideByJob = new Map(overrides.map((o) => [o.jobId, o.phase]))

    // Cadence rollup needs today + tomorrow as YYYY-MM-DD strings to
    // compare against Order.startDate/endDate (`@db.Date`, which Prisma
    // returns as JS Date at 00:00:00 UTC). Computed once per request.
    const { today, tomorrow } = cadenceDays()

    // RW rollup for the listed jobs — one batch, so board cards don't
    // read "$— / 0 orders" for jobs whose money lives in RentalWorks.
    const jobIds = jobs.map((j) => j.id)
    const rwLinks = jobIds.length
      ? await prisma.jobRwOrder.findMany({
          where: { jobId: { in: jobIds } },
          select: { jobId: true, rwOrderNumber: true },
        })
      : []
    const rwByJob = new Map<string, string[]>()
    for (const l of rwLinks) {
      if (!rwByJob.has(l.jobId)) rwByJob.set(l.jobId, [])
      rwByJob.get(l.jobId)!.push(l.rwOrderNumber)
    }
    const allRwOrderNumbers = [...new Set(rwLinks.map((l) => l.rwOrderNumber))]
    const rwSums = allRwOrderNumbers.length
      ? await prisma.rwInvoice.groupBy({
          by: ['orderNumber'],
          where: { orderNumber: { in: allRwOrderNumbers }, status: { not: RW_VOID } },
          _sum: { invoiceTotal: true },
        })
      : []
    const rwSumByOrder = new Map(rwSums.map((g) => [g.orderNumber as string, Number(g._sum.invoiceTotal ?? 0)]))

    const enriched = jobs.map((j) => {
      const rwNums = rwByJob.get(j.id) ?? []
      const rwInvoicedTotal = rwNums.reduce((sum, num) => sum + (rwSumByOrder.get(num) ?? 0), 0)
      const orderTotal = j.orders
        .filter((o) => o.status !== ('CANCELLED' as OrderStatus))
        .reduce((sum, o) => sum + Number(o.subtotal || 0), 0)

      const primaryContact = pickPrimaryContact(j.jobContacts)

      let pipelineColumn: PipelineColumn | null = null
      let quoteBreakdown:
        | { quotes: number; won: number; pending: number; lost: number; expired: number }
        | undefined
      let departments: LineItemDepartment[] | undefined

      if (includeQuoteStatus) {
        const qs = j.orders
          .map((o) => (o as { quoteStatus?: OrderQuoteStatus }).quoteStatus)
          .filter((s): s is OrderQuoteStatus => !!s)
        pipelineColumn = derivePipelineColumn(qs)
        quoteBreakdown = {
          quotes: qs.length,
          won: qs.filter((s) => s === 'WON').length,
          pending: qs.filter((s) => s === 'DRAFT' || s === 'SENT').length,
          lost: qs.filter((s) => s === 'LOST').length,
          expired: qs.filter((s) => s === 'EXPIRED').length,
        }
      }

      if (includeDepartments) {
        const deptSet = new Set<LineItemDepartment>()
        for (const o of j.orders) {
          const lis = (o as { lineItems?: { department: LineItemDepartment }[] }).lineItems
          if (lis) for (const li of lis) deptSet.add(li.department)
        }
        departments = Array.from(deptSet)
      }

      // Phase 7 — paperwork rollup. Per-Order SignedAgreement rows
      // aggregated to a single state per contractType across all
      // non-cancelled orders on the job. CoiCheck is per-Job.
      const liveOrders = liveOrdersForRollup(j.orders)
      const allAgreements = liveOrders.flatMap(
        (o) =>
          (o as {
            signedAgreements?: { contractType: ContractType; status: AgreementStatus; coveredByAgreementId: string | null }[]
          }).signedAgreements || [],
      )
      // An addendum to an on-file master covers the job outright — the
      // annual account signed once for the year (lib/orders/annualCoverage).
      // Same rule as the detail page's resolveCoverage: an annual master
      // past its expiry reads as unsigned again, not as covered.
      const now = new Date()
      const coveredBy = (type: ContractType) =>
        j.agreementAddenda.some(
          (a) =>
            a.companyAgreement.contractType === type &&
            !(a.companyAgreement.isAnnual && a.companyAgreement.expiryDate && a.companyAgreement.expiryDate < now),
        )
      const rentalAgreement = coveredBy('RENTAL_AGREEMENT')
        ? { state: 'SIGNED' as const, count: Math.max(1, liveOrders.length) }
        : rollupAgreementState(allAgreements.filter((a) => a.contractType === 'RENTAL_AGREEMENT'), liveOrders.length)
      const stageAgreementsExist = allAgreements.some((a) => a.contractType === 'STAGE_CONTRACT')
      const stageAgreement = coveredBy('STAGE_CONTRACT')
        ? { state: 'SIGNED' as const, count: Math.max(1, liveOrders.length) }
        : stageAgreementsExist
          ? rollupAgreementState(allAgreements.filter((a) => a.contractType === 'STAGE_CONTRACT'), liveOrders.length)
          : null
      let coi: { state: CoiRollupState; expiresAt?: string | null } = { state: 'NONE' }
      const hasVehicles = jobHasVehicles.has(j.id) ? jobHasVehicles.get(j.id)! : null
      if (j.coiChecks[0]) {
        coi = rollupCoiState({ ...j.coiChecks[0], jobHasVehicles: hasVehicles })
      } else if (
        j.companyId &&
        companyCoisByCompany.has(j.companyId) &&
        !separatePolicyJobIds.has(j.id)
      ) {
        // Newest-expiry first (the query's order), so the first cert that
        // covers the whole window is the one that governs; failing that,
        // the first that covers the start — the same fallback the detail
        // route makes, with the gap named there.
        const range = deriveJobDateRange(j.orders, j.bookings)
        const start = range.start ?? new Date()
        const end = range.end ?? start
        const certs = companyCoisByCompany.get(j.companyId)!
        const covering =
          certs.find((c) => c.policyExpiryDate && c.policyExpiryDate >= end) ??
          certs.find((c) => c.policyExpiryDate && c.policyExpiryDate >= start)
        if (covering) coi = rollupCoiState({ ...covering, jobHasVehicles: hasVehicles })
      }

      const paperwork = {
        rental: rentalAgreement,
        stage: stageAgreement,
        coi,
      }

      // Phase 7 — billing rollup across the job's non-cancelled orders.
      // Reads only the stored reconciled fields; no payment math here.
      const allInvoices = liveOrders.flatMap(
        (o) =>
          (o as {
            invoices?: {
              status: InvoiceStatus
              balanceDue: import('@prisma/client').Prisma.Decimal
              total: import('@prisma/client').Prisma.Decimal
              dueDate: Date | null
              _count?: { insuranceClaims: number }
            }[]
          }).invoices || [],
      )
      const billing = rollupBillingState(allInvoices)

      // Operational cadence rollup — the derived "where is this job"
      // answer. HOLD / LOST / WRAPPED (the human off-ramps) win outright;
      // every other job derives from its orders' status + start/end vs
      // today/tomorrow. See src/lib/jobs/cadence.ts.
      // Trucks that have physically left join the rollup beside the
      // orders — a blind-pickup self check-out marks the assignment
      // CHECKED_OUT hours before anyone touches the order.
      const vehiclesOnJob = j.bookings.flatMap((b) =>
        b.items.flatMap((it) => it.assignments.map((a) => ({ status: a.status, endDate: a.endDate }))),
      )
      const cadence = rollupCadence(j.status, liveOrders, today, tomorrow, vehiclesOnJob)

      // L&D marker — booking-side or invoice-side count > 0 on any order.
      const hasLD = liveOrders.some(
        (o) =>
          ((o as { booking?: { _count: { insuranceClaims: number } } | null }).booking?._count?.insuranceClaims ?? 0) > 0 ||
          ((o as { invoices?: { _count?: { insuranceClaims: number } }[] }).invoices || []).some(
            (inv) => (inv._count?.insuranceClaims ?? 0) > 0,
          ),
      )

      // Blind handoff markers — true when ANY order on the job has the
      // matching flag set. Surfaced as eye-off icons next to the job
      // name on the Jobs list.
      const blindPickup = liveOrders.some((o) => (o as { blindPickup?: boolean }).blindPickup)
      const blindReturn = liveOrders.some((o) => (o as { blindReturn?: boolean }).blindReturn)

      // Stage-scope detection — drives whether the Stage Contract chip
      // renders on the Jobs list. True when ANY live order on the job
      // either has a negotiated StageBookingTerms row OR a
      // STAGE_CONTRACT agreement. The first signal catches mid-
      // negotiation jobs before any contract is generated.
      const hasStageScope = liveOrders.some((o) => {
        const oo = o as {
          stageBookingTerms?: { id: string } | null
          signedAgreements?: { contractType: ContractType }[]
        }
        if (oo.stageBookingTerms) return true
        return (oo.signedAgreements || []).some((a) => a.contractType === 'STAGE_CONTRACT')
      })

      // Booking envelope: min start / max end across the job's bookings
      // — the date fallback for jobs with no live orders (all the
      // Planyo imports today). Delivery = any booking with an address.
      //
      // CANCELLED bookings are excluded, and that exclusion is the
      // whole point: the envelope used to span every booking whatever
      // its status, so a job whose only booking was cancelled still
      // got a window, still looked like it had gear out, and — once
      // the end date passed — read "Not returned" forever. 24 jobs sat
      // in that state on 2026-08-26, most of them the Planyo
      // cancellations swept on 8/25. A cancelled hold never went out
      // and has nothing to bring back.
      const liveBookings = j.bookings.filter((b) => b.status !== 'CANCELLED')
      const bStarts = liveBookings.map((b) => b.startDate).filter((d): d is Date => !!d)
      const bEnds = liveBookings.map((b) => b.endDate).filter((d): d is Date => !!d)
      const bookingWindow =
        bStarts.length || bEnds.length
          ? {
              start: bStarts.length ? new Date(Math.min(...bStarts.map((d) => d.getTime()))).toISOString().slice(0, 10) : null,
              end: bEnds.length ? new Date(Math.max(...bEnds.map((d) => d.getTime()))).toISOString().slice(0, 10) : null,
            }
          : null
      // Same reasoning: a cancelled booking's delivery address is not a
      // delivery anybody has to make.
      const hasDelivery = liveBookings.some((b) => !!b.deliveryAddress?.trim())

      // Readiness rollup — the five-check "can this job go out" answer
      // (gear · COI · agreement · card · driver), derived here and ONLY
      // here so the sidebar chip and the detail strip agree. The chip
      // renders only on outbound rows (readinessApplies); it ships on
      // every row because rowState is a client-side derivation.
      type ItemRow = {
        status: string
        quantity: number
        category: { name: string } | null
        assignments: { status: string; asset: { unitName: string } | null; _count: { driverAssignments: number } }[]
      }
      const liveItems = liveBookings.flatMap(
        (b) => ((b as { items?: ItemRow[] }).items || []).filter(
          (it) => it.status === 'REQUESTED' || it.status === 'ASSIGNED',
        ),
      )
      const activeAssignments = liveItems.flatMap((it) =>
        it.assignments.filter((a) => a.status === 'ASSIGNED' || a.status === 'CHECKED_OUT'),
      )

      // What's on the job, in words — "2× Cargo Van (38, 41) · 1× ProScout".
      // Grouped by category across every live booking; the unit names are
      // the ACTIVE assignments, so a category with none listed is a hold
      // nobody has put a truck on yet. Order preserved by first sight so
      // the tile reads the same way each load.
      const gearByCat = new Map<string, { label: string; qty: number; units: string[] }>()
      for (const it of liveItems) {
        const label = it.category?.name ?? 'Item'
        const g = gearByCat.get(label) ?? { label, qty: 0, units: [] }
        g.qty += it.quantity || 1
        for (const a of it.assignments) {
          if ((a.status === 'ASSIGNED' || a.status === 'CHECKED_OUT') && a.asset?.unitName) {
            g.units.push(a.asset.unitName)
          }
        }
        gearByCat.set(label, g)
      }
      const gear = [...gearByCat.values()]
      // Client said yes, nobody has booked it yet (Wes 2026-09-01: an
      // approved order "should go somewhere more prominent"). APPROVED
      // is the one status where the ball is entirely in OUR court and
      // the next move is a single click — but the cadence rollup folds
      // it into 'booked', so the board showed it as work already locked
      // in. Carried as its own count rather than a new CadenceState,
      // which would have to re-tier the colours, legend and sort.
      // The client answered the agreement and we have not answered back.
      const redlinePending = countRedlinesAwaitingAction(allAgreements)

      const approvedUnbooked = liveOrders.filter(
        (o) => (o as { status: OrderStatus }).status === 'APPROVED',
      ).length

      const readiness = computeReadiness({
        coi: paperwork.coi.state,
        rental: paperwork.rental.state,
        stage: paperwork.stage?.state ?? null,
        cardOnFile:
          liveBookings.some(
            (b) => ((b as { paperworkRequests?: { id: string }[] }).paperworkRequests || []).length > 0,
          ) || (!!j.companyId && walletCardCompanies.has(j.companyId)),
        cardRequested: liveBookings.some(
          (b) => ((b as { _count?: { paperworkRequests: number } })._count?.paperworkRequests ?? 0) > 0,
        ),
        gear: {
          total: liveItems.length,
          assigned: liveItems.filter((it) => it.status === 'ASSIGNED').length,
        },
        drivers: {
          units: activeAssignments.length,
          named: activeAssignments.filter((a) => a._count.driverAssignments > 0).length,
        },
      })
      // Dropping cancelled bookings from the envelope is not enough on
      // its own: Planyo imports copy the booking's dates onto the Job
      // row too, and those OUTRANK the envelope. So the fact has to
      // travel as a fact — the list can't infer it from dates.
      const allBookingsCancelled =
        j.bookings.length > 0 && liveBookings.length === 0

      // ── Released fleet (Wes 2026-09-08) ───────────────────────────
      // What this job WAS holding and gave back, and what it still
      // holds. Counted across EVERY booking, cancelled ones included:
      // releasing the last item cancels the booking, so looking only at
      // live bookings would make a fully released job look like it never
      // held anything. Sub-rentals reach the job by either anchor
      // (job-linked estimate, or through an order), so both are unioned
      // and de-duplicated is unnecessary — the two sets are disjoint by
      // construction (a row has orderId set or it doesn't).
      type ReleaseBooking = { endDate: Date | null; items?: { status: string }[] }
      const releaseBookings = j.bookings as unknown as ReleaseBooking[]
      const allItems = releaseBookings.flatMap((b) => b.items || [])
      const jobSubRentals = [
        ...((j as unknown as { subRentals?: { status: string; endDate: Date | null }[] }).subRentals || []),
        ...j.orders.flatMap(
          (o) => (o as unknown as { subRentals?: { status: string; endDate: Date | null }[] }).subRentals || [],
        ),
      ]
      // The far edge of what the release FREED. The badge is scoped by it
      // (see holdsFullyReleased): a cart released in May must not sit in
      // red beside this morning's release. Read off the released rows
      // themselves, because a fully released job's bookings are cancelled
      // and drop out of every "live window" the list computes.
      const releasedEnds = [
        ...releaseBookings
          .filter((b) => (b.items || []).some((it) => it.status === 'UNFULFILLED'))
          .map((b) => b.endDate),
        ...jobSubRentals.filter((sr) => sr.status === 'CANCELLED').map((sr) => sr.endDate),
      ].filter((d): d is Date => !!d)
      const releasedHolds = {
        ours: allItems.filter((it) => it.status === 'UNFULFILLED').length,
        partner: jobSubRentals.filter((sr) => sr.status === 'CANCELLED').length,
        live:
          allItems.filter((it) => it.status === 'REQUESTED' || it.status === 'ASSIGNED').length +
          jobSubRentals.filter(
            (sr) => sr.status !== 'CANCELLED' && sr.status !== 'RETURNED',
          ).length,
        windowEnd: releasedEnds.length
          ? releasedEnds.reduce((a, b) => (a > b ? a : b)).toISOString().slice(0, 10)
          : null,
      }

      const { orders, coiChecks: _ignoreCoi, bookings: _ignoreBookings, agreementAddenda: _ignoreAddenda, subRentals: _ignoreSubRentals, ...rest } = j
      void _ignoreSubRentals
      void _ignoreCoi
      void _ignoreBookings
      void _ignoreAddenda
      // Newest of: the job row, and every order on it. Sending a quote
      // touches the ORDER, so a job-only timestamp would leave a
      // just-quoted job sitting wherever it was created.
      const lastActivityAt = [
        j.updatedAt,
        ...j.orders.flatMap((o) => [o.updatedAt, o.quoteSentAt].filter(Boolean) as Date[]),
      ]
        .filter(Boolean)
        .reduce((max, d) => (d > max ? d : max), j.updatedAt)

      // Where this job came from. The JOB's own cart id is the anchor;
      // a job with no cart id whose bookings are all imports is still an
      // import, so the bookings are consulted too.
      const importedBooking = j.bookings.some((b) => !isNativeToHq(b))
      const origin = jobOrigin({
        planyoCartId: j.planyoCartId ?? (importedBooking ? 'imported' : null),
        hasRwLink: rwNums.length > 0,
      })

      return {
        ...rest,
        origin,
        nativeBookingCount: j.bookings.filter((b) => isNativeToHq(b)).length,
        lastActivityAt,
        bookingWindow,
        hasDelivery,
        allBookingsCancelled,
        releasedHolds,
        boardPhaseOverride: overrideByJob.get(j.id) ?? null,
        estimatedValue: j.estimatedValue == null ? null : Number(j.estimatedValue),
        orderTotal,
        rwInvoicedTotal,
        rwOrderCount: rwNums.length,
        primaryContact: primaryContact
          ? {
              id: primaryContact.person.id,
              firstName: primaryContact.person.firstName,
              lastName: primaryContact.person.lastName,
              email: primaryContact.person.email,
              phone: (primaryContact.person as { phone?: string | null }).phone ?? null,
              role: primaryContact.role,
              isPrimary: primaryContact.isPrimary,
            }
          : null,
        paperwork,
        billing,
        readiness,
        gear,
        approvedUnbooked,
        redlinePending,
        cadence,
        hasLD,
        hasStageScope,
        blindPickup,
        blindReturn,
        ...(includeQuoteStatus ? { pipelineColumn, quoteBreakdown } : {}),
        ...(includeDepartments ? { departments } : {}),
      }
    })

    return NextResponse.json({ jobs: enriched })
  } catch (error) {
    console.error('GET /api/jobs error:', error)
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }
}

// POST /api/jobs
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      name,
      companyId,
      productionType,
      productionTypeProfileId,
      status,
      notes,
      estimatedValue,
      contacts, // [{ personId, role, isPrimary }]
    } = body
    let { agentId } = body

    // Fall back to logged-in user for agentId if not supplied
    if (!agentId) {
      const session = await getServerSession()
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true },
        })
        if (user) agentId = user.id
      }
    }

    if (!agentId) {
      return NextResponse.json({ error: 'agentId required (no session user)' }, { status: 400 })
    }
    // companyUnknown is the agent saying "I don't have it yet" — the
    // draft helper stands up a provisional company in that case.
    if (!name || (!companyId && !(typeof body.companyName === 'string' && body.companyName.trim()) && body.companyUnknown !== true)) {
      return NextResponse.json(
        { error: 'name and companyId (or companyName) are required' },
        { status: 400 }
      )
    }

    // Creation lives in ONE place (Job-as-root step 2): the same
    // createJobFromDraft the resolver modal uses. This route is now a
    // thin HTTP shell over it — company resolve-or-create via
    // companyNameKey, person via resolvePersonByEmail, jobCode via
    // nextJobCode, all inside the module.
    const result = await createJobFromDraft(
      {
        name,
        companyId: companyId || null,
        companyName: typeof body.companyName === 'string' ? body.companyName : null,
        companyUnknown: body.companyUnknown === true,
        // Everyone the client CC'd on the inquiry — becomes a JobContact.
        ccContactEmails: Array.isArray(body.ccContactEmails)
          ? body.ccContactEmails.filter((e: unknown): e is string => typeof e === 'string')
          : [],
        contactName: typeof body.contactName === 'string' ? body.contactName : null,
        contactPhone: typeof body.contactPhone === 'string' ? body.contactPhone : null,
        contactEmail: typeof body.contactEmail === 'string' ? body.contactEmail : null,
        // No job-level dates: a job has no dates of its own, its orders
        // carry them (lib/jobs/dateRange), and the columns themselves were
        // dropped from the schema AND the database on 2026-08-31.
        // legacy callers that omit status keep getting QUOTED; the
        // resolver modal passes NEW explicitly.
        status: status || 'QUOTED',
        notes: notes || null,
        productionType: productionType || null,
        productionTypeProfileId: productionTypeProfileId || null,
        estimatedValue: estimatedValue == null || estimatedValue === '' ? null : Number(estimatedValue),
        contacts,
      },
      agentId,
    )

    // Refresh the Company's most-common-profile cache (awaited — see
    // note in git history; Vercel kills detached promises).
    try {
      await recomputeMostCommonProductionTypeProfile(result.job.companyId)
    } catch (err) {
      console.warn('[jobs POST] recompute most-common profile failed:', err)
    }

    // Re-fetch with the include shape callers expect (company/agent/contacts).
    const job = await prisma.job.findUnique({
      where: { id: result.job.id },
      include: {
        company: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        jobContacts: { include: { person: true } },
      },
    })

    return NextResponse.json(
      {
        job: job
          ? { ...job, estimatedValue: job.estimatedValue == null ? null : Number(job.estimatedValue) }
          : result.job,
        ...(result.companyResolution ? { companyResolution: result.companyResolution } : {}),
        ...(result.contactWarning ? { contactWarning: result.contactWarning } : {}),
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/jobs error:', error)
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }
}

// Phase 7 — Jobs-list paperwork rollup helpers.
//
// rollupAgreementState moved to src/lib/jobs/readinessBatch.ts (2026-09-09)
// when the gantt started needing the same verdict: it is imported above, not
// redefined here, so the list and the board cannot disagree about "signed".

// COI state lives in src/lib/coi/coiState.ts — shared with the job detail
// page so the tile and the strip cannot disagree (2026-09-06).

// Phase 7 — billing rollup. Inputs are the stored, reconciled Invoice
// columns; this function does NOT consult Payment rows. The columns it
// reads (status, amountPaid, balanceDue) are maintained by
// reconcileInvoiceTotals which counts only CLEARED non-voided payments,
// so PENDING / SETTLED ACH cannot make a job read as PAID.
//
// Precedence (top → bottom): NOT_INVOICED → OVERDUE → PARTIALLY_PAID →
// PAID → SENT → DRAFT. OVERDUE wins over PARTIALLY_PAID so an overdue
// partial reads as urgent rather than "progress".
export type BillingRollupState =
  | 'NOT_INVOICED'
  | 'DRAFT'
  | 'SENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'

function rollupBillingState(
  invoices: {
    status: InvoiceStatus
    balanceDue: import('@prisma/client').Prisma.Decimal
    total: import('@prisma/client').Prisma.Decimal
    dueDate: Date | null
  }[],
): { state: BillingRollupState; balanceDue: number } {
  if (invoices.length === 0) return { state: 'NOT_INVOICED', balanceDue: 0 }

  const live = invoices.filter((i) => i.status !== 'VOID')
  if (live.length === 0) return { state: 'NOT_INVOICED', balanceDue: 0 }

  const totalBalance = live.reduce((s, i) => s + Number(i.balanceDue), 0)
  const totalBilled = live.reduce((s, i) => s + Number(i.total), 0)
  const totalPaid = totalBilled - totalBalance

  const now = Date.now()
  const hasOverdue = live.some(
    (i) =>
      i.status !== 'PAID' &&
      i.status !== 'DRAFT' &&
      i.dueDate != null &&
      i.dueDate.getTime() < now &&
      Number(i.balanceDue) > 0,
  )
  if (hasOverdue) {
    return { state: 'OVERDUE', balanceDue: round2(totalBalance) }
  }

  const allDraft = live.every((i) => i.status === 'DRAFT')
  if (allDraft) return { state: 'DRAFT', balanceDue: round2(totalBalance) }

  // PAID requires at least one non-DRAFT/non-VOID invoice (a job with
  // only DRAFT invoices doesn't read as paid even if their balanceDue
  // happens to be zero) and a zero aggregate balance.
  const hasIssued = live.some((i) => i.status !== 'DRAFT')
  if (hasIssued && totalBalance <= 0.005) {
    return { state: 'PAID', balanceDue: 0 }
  }

  const hasPartial = live.some((i) => i.status === 'PARTIAL')
  if (hasPartial || totalPaid > 0.005) {
    return { state: 'PARTIALLY_PAID', balanceDue: round2(totalBalance) }
  }

  return { state: 'SENT', balanceDue: round2(totalBalance) }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
