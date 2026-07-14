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
  InvoiceStatus,
} from '@prisma/client'
import { derivePipelineColumn, type PipelineColumn } from '@/lib/sales/pipeline'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import { nextJobCode } from '@/lib/jobs/nextJobCode'
import { recomputeMostCommonProductionTypeProfile } from '@/lib/companies/recomputeMostCommonProductionTypeProfile'
import { resolveDataScope, jobScopeWhere } from '@/lib/auth/scope'
import { createJobFromDraft } from '@/lib/jobs/resolveJob'

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
            person: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          },
        },
        orders: {
          select: {
            status: true,
            subtotal: true,
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
              select: { contractType: true, status: true },
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
          },
        },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    // Cadence rollup needs today + tomorrow as YYYY-MM-DD strings to
    // compare against Order.startDate/endDate (`@db.Date`, which Prisma
    // returns as JS Date at 00:00:00 UTC). Computed once per request.
    const todayDate = new Date()
    todayDate.setUTCHours(0, 0, 0, 0)
    const tomorrowDate = new Date(todayDate)
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1)
    const today = todayDate.toISOString().slice(0, 10)
    const tomorrow = tomorrowDate.toISOString().slice(0, 10)

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

      // Phase 7 — operational cadence rollup. Pre-booked Jobs (QUOTED /
      // HOLD / LOST) skip the order-level computation and adopt the
      // JobStatus directly. ACTIVE/WRAPPED Jobs derive from each order's
      // status + start/end vs today/tomorrow.
      const cadence = rollupCadence(j.status, liveOrders, today, tomorrow)

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
              phone: (primaryContact.person as { phone?: string | null }).phone ?? null,
              role: primaryContact.role,
              isPrimary: primaryContact.isPrimary,
            }
          : null,
        paperwork,
        billing,
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

    if (!agentId) {
      return NextResponse.json({ error: 'agentId required (no session user)' }, { status: 400 })
    }
    if (!name || (!companyId && !(typeof body.companyName === 'string' && body.companyName.trim()))) {
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
        contactName: typeof body.contactName === 'string' ? body.contactName : null,
        contactPhone: typeof body.contactPhone === 'string' ? body.contactPhone : null,
        contactEmail: typeof body.contactEmail === 'string' ? body.contactEmail : null,
        startDate: startDate || null,
        endDate: endDate || null,
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

// Phase 7 — operational cadence rollup. Replaces the JobStatus pill on
// the list with a single merged operational state. Pre-booked Jobs
// (QUOTED / HOLD / LOST) keep their commercial state because there's
// no operational cadence yet. WRAPPED short-circuits to wrapped. For
// ACTIVE Jobs, every non-cancelled order is mapped to a cadence event
// and the most-urgent wins; if that event is a return AND other orders
// are still out, the rollup is flagged partial.
export type CadenceState =
  | 'new'
  | 'quoted'
  | 'hold'
  | 'lost'
  | 'booked'
  | 'picking-tmw'
  | 'picking-today'
  | 'on-rental'
  | 'returning-tmw'
  | 'returning-today'
  | 'returned'
  | 'invoiced'
  | 'wrapped'

// Precedence per spec: most-urgent at the top. Indexes drive the sort.
const CADENCE_RANK: CadenceState[] = [
  'returning-today',
  'picking-today',
  'returning-tmw',
  'picking-tmw',
  'on-rental',
  'booked',
  'returned',
  'invoiced',
  'wrapped',
]

// Orders that count as "still out" for partial-return detection: their
// return hasn't happened yet, so the job isn't fully back.
const STILL_OUT_EVENTS: CadenceState[] = [
  'picking-today',
  'picking-tmw',
  'on-rental',
  'booked',
]

function cadenceForOrder(
  o: { status: OrderStatus; startDate: Date | null; endDate: Date | null },
  today: string,
  tomorrow: string,
): CadenceState | null {
  if (o.status === 'CANCELLED' || o.status === 'DRAFT' || o.status === 'QUOTE_SENT') {
    return null
  }
  const start = o.startDate ? o.startDate.toISOString().slice(0, 10) : null
  const end = o.endDate ? o.endDate.toISOString().slice(0, 10) : null

  if (o.status === 'CLOSED') return 'wrapped'
  if (o.status === 'INVOICED' || o.status === 'LD_CHECK') return 'invoiced'
  if (o.status === 'RETURNED') return 'returned'

  // Out / awaiting pickup. ON_JOB clearly out; LOADED_READY is the day
  // before pickup OR pickup-day-not-yet-checked-out (treated as still
  // outbound until the dates say otherwise).
  if (o.status === 'ON_JOB' || o.status === 'LOADED_READY') {
    if (end && end === today) return 'returning-today'
    if (end && end === tomorrow) return 'returning-tmw'
    if (start && end && start <= today && today <= end) return 'on-rental'
    if (start && start === today) return 'picking-today'
    if (start && start === tomorrow) return 'picking-tmw'
    return 'booked'
  }
  if (o.status === 'APPROVED' || o.status === 'BOOKED') {
    if (start && start === today) return 'picking-today'
    if (start && start === tomorrow) return 'picking-tmw'
    return 'booked'
  }
  return null
}

function rollupCadence(
  jobStatus: JobStatus,
  liveOrders: { status: OrderStatus; startDate: Date | null; endDate: Date | null }[],
  today: string,
  tomorrow: string,
): { state: CadenceState; partial: boolean } {
  // Pre-booked commercial states bypass operational derivation.
  if (jobStatus === 'NEW') return { state: 'new', partial: false }
  if (jobStatus === 'QUOTED') return { state: 'quoted', partial: false }
  if (jobStatus === 'HOLD') return { state: 'hold', partial: false }
  if (jobStatus === 'LOST') return { state: 'lost', partial: false }
  if (jobStatus === 'WRAPPED') return { state: 'wrapped', partial: false }

  const events = liveOrders
    .map((o) => cadenceForOrder(o, today, tomorrow))
    .filter((e): e is CadenceState => e !== null)
  if (events.length === 0) {
    // ACTIVE Job with only DRAFT / QUOTE_SENT orders — fall back to
    // booked-shaped state for the rollup; rare but possible mid-cycle.
    return { state: 'booked', partial: false }
  }

  events.sort((a, b) => CADENCE_RANK.indexOf(a) - CADENCE_RANK.indexOf(b))
  const top = events[0]

  const isReturnEvent = top === 'returning-today' || top === 'returning-tmw' || top === 'returned'
  const partial = isReturnEvent && events.some((e) => STILL_OUT_EVENTS.includes(e))

  return { state: top, partial }
}
