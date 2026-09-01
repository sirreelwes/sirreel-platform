import { NextRequest, NextResponse } from 'next/server'
import { isSignedAgreementStatus } from '@/lib/portal/agreementStatus'
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
import { computeReadiness } from '@/lib/jobs/readiness'

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
          },
        },
        _count: { select: { orders: true } },
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
                assignments: {
                  select: {
                    status: true,
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
      const liveOrders = j.orders.filter((o) => o.status !== ('CANCELLED' as OrderStatus))
      const allAgreements = liveOrders.flatMap(
        (o) =>
          (o as {
            signedAgreements?: { contractType: ContractType; status: AgreementStatus; coveredByAgreementId: string | null }[]
          }).signedAgreements || [],
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

      // Operational cadence rollup — the derived "where is this job"
      // answer. HOLD / LOST / WRAPPED (the human off-ramps) win outright;
      // every other job derives from its orders' status + start/end vs
      // today/tomorrow. See src/lib/jobs/cadence.ts.
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
        assignments: { status: string; _count: { driverAssignments: number } }[]
      }
      const liveItems = liveBookings.flatMap(
        (b) => ((b as { items?: ItemRow[] }).items || []).filter(
          (it) => it.status === 'REQUESTED' || it.status === 'ASSIGNED',
        ),
      )
      const activeAssignments = liveItems.flatMap((it) =>
        it.assignments.filter((a) => a.status === 'ASSIGNED' || a.status === 'CHECKED_OUT'),
      )
      // Client said yes, nobody has booked it yet (Wes 2026-09-01: an
      // approved order "should go somewhere more prominent"). APPROVED
      // is the one status where the ball is entirely in OUR court and
      // the next move is a single click — but the cadence rollup folds
      // it into 'booked', so the board showed it as work already locked
      // in. Carried as its own count rather than a new CadenceState,
      // which would have to re-tier the colours, legend and sort.
      const approvedUnbooked = liveOrders.filter(
        (o) => (o as { status: OrderStatus }).status === 'APPROVED',
      ).length

      const readiness = computeReadiness({
        coi: paperwork.coi.state,
        rental: paperwork.rental.state,
        stage: paperwork.stage?.state ?? null,
        cardOnFile: liveBookings.some(
          (b) => ((b as { paperworkRequests?: { id: string }[] }).paperworkRequests || []).length > 0,
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

      const { orders, coiChecks: _ignoreCoi, bookings: _ignoreBookings, ...rest } = j
      void _ignoreCoi
      void _ignoreBookings
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
        approvedUnbooked,
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
        // Job-level dates are no longer written — a job has no dates of
        // its own; its orders carry them (lib/jobs/dateRange). The columns
        // remain in the DB per the additive-only rule, unread and unwritten.
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
// Was a local list that missed SIGNED_OFFLINE, so a filed agreement still
// read "RENTAL Sent" on the pipeline card. See isSignedAgreementStatus.
const PRE_RELEASE_STATES: AgreementStatus[] = ['PORTAL_GENERATED']

export type AgreementRollupState = 'NONE' | 'DRAFT' | 'SENT' | 'PARTIAL' | 'SIGNED'

function rollupAgreementState(
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
