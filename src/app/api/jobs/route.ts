import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import type {
  JobStatus,
  OrderStatus,
  OrderQuoteStatus,
  LineItemDepartment,
  AgreementStatus,
  ContractType,
  ReviewDecision,
} from '@prisma/client'
import { derivePipelineColumn, type PipelineColumn } from '@/lib/sales/pipeline'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import { recomputeMostCommonProductionTypeProfile } from '@/lib/companies/recomputeMostCommonProductionTypeProfile'
import { resolveDataScope, jobScopeWhere } from '@/lib/auth/scope'

export const dynamic = 'force-dynamic'

// GET /api/jobs?companyId=xxx&status=ACTIVE&statuses=QUOTED,ACTIVE&agentId=xxx&mine=1&search=foo
//                &include=quoteStatus,departments  (Phase 1 sales pipeline)
//                &orphans=1  (only QUOTED jobs with no sent/durable order)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId')
  const status = searchParams.get('status') as JobStatus | null
  const statusesParam = searchParams.get('statuses')
  let agentId = searchParams.get('agentId')
  const mine = searchParams.get('mine') === '1'
  const search = searchParams.get('search')
  const orphans = searchParams.get('orphans') === '1'
  const includeParam = searchParams.get('include') || ''
  const includes = new Set(includeParam.split(',').map((s) => s.trim()).filter(Boolean))
  const includeQuoteStatus = includes.has('quoteStatus')
  const includeDepartments = includes.has('departments')

  const statuses = statusesParam
    ? (statusesParam.split(',').filter(Boolean) as JobStatus[])
    : null

  // Phase 6.5 — data scope enforcement. OWN users see only their own
  // jobs regardless of client params. ADMIN / MANAGER always TEAM.
  const scope = await resolveDataScope()
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
        jobContacts: {
          include: {
            person: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
        orders: {
          select: {
            status: true,
            subtotal: true,
            // Phase 7 paperwork rollup — minimal SignedAgreement
            // select. Aggregated across the job's non-cancelled orders
            // to compute Rental + Stage paperwork chips for the list.
            signedAgreements: {
              select: { contractType: true, status: true },
            },
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
          },
        },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    const enriched = jobs.map((j) => {
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
      const liveOrders = j.orders.filter((o) => o.status !== ('CANCELLED' as OrderStatus))
      const allAgreements = liveOrders.flatMap(
        (o) => (o as { signedAgreements?: { contractType: ContractType; status: AgreementStatus }[] }).signedAgreements || [],
      )
      const rentalAgreement = rollupAgreementState(allAgreements.filter((a) => a.contractType === 'RENTAL_AGREEMENT'), liveOrders.length)
      const stageAgreementsExist = allAgreements.some((a) => a.contractType === 'STAGE_CONTRACT')
      const stageAgreement = stageAgreementsExist
        ? rollupAgreementState(allAgreements.filter((a) => a.contractType === 'STAGE_CONTRACT'), liveOrders.length)
        : null
      const coi = j.coiChecks[0]
        ? rollupCoiState(j.coiChecks[0])
        : { state: 'NONE' as const }

      const paperwork = {
        rental: rentalAgreement,
        stage: stageAgreement,
        coi,
      }

      const { orders, coiChecks: _ignoreCoi, ...rest } = j
      void _ignoreCoi
      return {
        ...rest,
        estimatedValue: j.estimatedValue == null ? null : Number(j.estimatedValue),
        orderTotal,
        primaryContact: primaryContact
          ? {
              id: primaryContact.person.id,
              firstName: primaryContact.person.firstName,
              lastName: primaryContact.person.lastName,
              email: primaryContact.person.email,
              role: primaryContact.role,
              isPrimary: primaryContact.isPrimary,
            }
          : null,
        paperwork,
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
      startDate,
      endDate,
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

    if (!name || !companyId || !agentId) {
      return NextResponse.json(
        {
          error: 'name, companyId, and agentId are required',
          gotName: !!name,
          gotCompanyId: !!companyId,
          gotAgentId: !!agentId,
        },
        { status: 400 }
      )
    }

    // Generate next jobCode (SR-JOB-0001 pattern)
    const lastJob = await prisma.job.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { jobCode: true },
    })
    const nextNum = lastJob
      ? parseInt(lastJob.jobCode.replace('SR-JOB-', ''), 10) + 1
      : 1
    const jobCode = `SR-JOB-${String(nextNum).padStart(4, '0')}`

    const job = await prisma.job.create({
      data: {
        jobCode,
        name,
        companyId,
        productionType: productionType || 'OTHER',
        // Optional FK to the new ProductionTypeProfile lookup. Empty
        // string → null so the form-default of '' doesn't FK-error.
        productionTypeProfileId:
          typeof productionTypeProfileId === 'string' && productionTypeProfileId
            ? productionTypeProfileId
            : null,
        status: status || 'QUOTED',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        agentId,
        notes,
        estimatedValue:
          estimatedValue == null || estimatedValue === '' ? null : Number(estimatedValue),
        ...(contacts && contacts.length > 0 && {
          jobContacts: {
            create: contacts.map((c: any) => ({
              personId: c.personId,
              role: c.role,
              isPrimary: c.isPrimary || false,
            })),
          },
        }),
      },
      include: {
        company: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        jobContacts: { include: { person: true } },
      },
    })

    // Refresh the Company's most-common-profile cache. Awaited (not
    // fire-and-forget) so the Company row is consistent on the
    // response — Vercel cuts off promises after the response is
    // returned, so detached recompute would risk being killed mid-
    // query. Negligible latency (one indexed findMany + one update).
    try {
      await recomputeMostCommonProductionTypeProfile(companyId)
    } catch (err) {
      // Don't block the Job-create response on a cache-refresh failure;
      // the next Job-create or a manual backfill will reconcile.
      console.warn('[jobs POST] recompute most-common profile failed:', err)
    }

    return NextResponse.json(
      {
        job: {
          ...job,
          estimatedValue: job.estimatedValue == null ? null : Number(job.estimatedValue),
        },
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
// SignedAgreement is per-Order. A job with two non-cancelled orders
// either has 0/1/2 rental agreement rows. We collapse to a single
// state for the chip:
//   - NONE   → no rows for this contractType
//   - DRAFT  → all rows in pre-release states (PORTAL_GENERATED only)
//   - SENT   → at least one out the door but nothing signed
//   - PARTIAL → some signed, some not (multi-order case)
//   - SIGNED → every live order has a SIGNED_* row
const SIGNED_STATES: AgreementStatus[] = ['SIGNED_BASELINE', 'SIGNED_NEGOTIATED']
const PRE_RELEASE_STATES: AgreementStatus[] = ['PORTAL_GENERATED']

export type AgreementRollupState = 'NONE' | 'DRAFT' | 'SENT' | 'PARTIAL' | 'SIGNED'

function rollupAgreementState(
  rows: { status: AgreementStatus }[],
  liveOrderCount: number,
): { state: AgreementRollupState; count: number } {
  if (rows.length === 0) return { state: 'NONE', count: 0 }
  const signed = rows.filter((r) => SIGNED_STATES.includes(r.status)).length
  if (signed === rows.length && rows.length >= liveOrderCount) {
    return { state: 'SIGNED', count: signed }
  }
  if (signed > 0) return { state: 'PARTIAL', count: signed }
  const allPreRelease = rows.every((r) => PRE_RELEASE_STATES.includes(r.status))
  if (allPreRelease) return { state: 'DRAFT', count: rows.length }
  return { state: 'SENT', count: rows.length }
}

export type CoiRollupState = 'NONE' | 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'ISSUE'

function rollupCoiState(coi: {
  humanDecision: ReviewDecision
  policyExpiryDate: Date | null
  coverageVerified: boolean
}): { state: CoiRollupState; expiresAt: string | null } {
  const expiresAt = coi.policyExpiryDate ? coi.policyExpiryDate.toISOString() : null
  const expired = coi.policyExpiryDate ? coi.policyExpiryDate.getTime() < Date.now() : false
  if (expired) return { state: 'EXPIRED', expiresAt }
  if (coi.humanDecision === 'REJECTED') return { state: 'ISSUE', expiresAt }
  if (coi.humanDecision === 'APPROVED' && coi.coverageVerified) return { state: 'VERIFIED', expiresAt }
  // PENDING / COUNTERED / APPROVED-without-coverage all read as "in flight".
  return { state: 'PENDING', expiresAt }
}
