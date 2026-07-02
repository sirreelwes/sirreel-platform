/**
 * POST /api/orders/from-parse
 *
 * Phase A of the order-builder consolidation. Atomic create endpoint
 * that materializes the parse-quote handoff into the DB in one
 * transaction. Once shipped end-to-end, `/orders/new-quote`'s
 * createQuote loop is replaced by a single call here + redirect to
 * `/orders/[id]`.
 *
 * Body shape (all decisions are the rep's choices, post-review):
 *   {
 *     companyDecision:
 *       | { kind: 'existing', companyId: string }
 *       | { kind: 'new', name: string, tier?, billingEmail? },
 *     jobDecision:
 *       | { kind: 'existing', jobId: string }
 *       | { kind: 'new', name: string, productionType?, productionTypeProfileId?,
 *           startDate?, endDate?, notes?, estimatedValue? },
 *     contactsDecision: Array<
 *       | { kind: 'existing_person', personId, role, isPrimary? }
 *       | { kind: 'new_person', firstName, lastName, email, phone?, title?, source?, role, isPrimary? }
 *     >,
 *     items: ResolvedItem[],          // shape from /api/orders/parse-quote
 *     parsed: {                        // header fields the rep edited in the wizard
 *       startDate?, endDate?, notes?, productionName?, …
 *     },
 *     discount?: { amount: number, label?: string },
 *   }
 *
 * Atomicity:
 *   - Everything (Company create, Job create, Order create, every
 *     OrderLineItem, optional discount, contact Persons + JobContacts)
 *     runs inside one `prisma.$transaction`. Any throw rolls back all
 *     of it — no orphan Company / Job / Person / Order.
 *
 * Capacity conflicts (the spec's non-negotiable):
 *   - A VEHICLES/STAGES line over capacity must NOT abort the create.
 *     We commit the OrderLineItem in its non-held state (no
 *     BookingItem write) and surface a warning. The rep resolves on
 *     `/orders/[id]` (adjust qty, accept the override via PUT, or
 *     reroute the line). PickList side still syncs normally — that's
 *     a warehouse-floor concern, separate from booking capacity.
 *
 * Reused helpers (no duplication of the POST line-items logic):
 *   - nextOrderNumber              (tx-scoped order numbering)
 *   - recomputeMostCommonProductionTypeProfile (post-tx, only when job created)
 *   - computeLineTotal             (single source of truth for line math)
 *   - rentalDays                   (days fallback when dates set but billableDays missing)
 *   - checkHoldFeasibility         (capacity pre-flight)
 *   - syncPickListOnLineAdd        (lane stamping + PickList side for WAREHOUSE)
 *   - syncHoldOnLineAdd            (BookingItem side for VEHICLES/STAGES)
 *   - recalcOrderTotals            (self-healing line + Order totals at the end)
 *
 * Returns: { orderId, warnings: [{ lineDescription, reason }] }
 * Gate:    getServerSession (matches POST /api/orders).
 */

import { NextRequest, NextResponse } from 'next/server'
import type { ClientTier, JobRole, LineItemDepartment, LineItemType, Prisma, ProductionType, RateType } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { nextOrderNumber, recalcOrderTotals, estimateRentalDays } from '@/lib/orders'
import { computeLineTotal } from '@/lib/orders/billing'
import { syncPickListOnLineAdd } from '@/lib/orders/pickListSync'
import { checkHoldFeasibility, syncHoldOnLineAdd } from '@/lib/orders/holdsSync'
import { resolveLineRate, logRateOverride } from '@/lib/pricing/resolveRate'
import { recomputeMostCommonProductionTypeProfile } from '@/lib/companies/recomputeMostCommonProductionTypeProfile'
import { nextJobCode } from '@/lib/jobs/nextJobCode'

export const dynamic = 'force-dynamic'

type TxClient = Prisma.TransactionClient

interface CompanyDecisionExisting { kind: 'existing'; companyId: string }
interface CompanyDecisionNew {
  kind: 'new'
  name: string
  tier?: ClientTier
  billingEmail?: string | null
}
type CompanyDecision = CompanyDecisionExisting | CompanyDecisionNew

interface JobDecisionExisting { kind: 'existing'; jobId: string }
interface JobDecisionNew {
  kind: 'new'
  name: string
  productionType?: ProductionType
  productionTypeProfileId?: string | null
  startDate?: string | null
  endDate?: string | null
  notes?: string | null
  estimatedValue?: number | string | null
}
type JobDecision = JobDecisionExisting | JobDecisionNew

interface ContactExisting {
  kind: 'existing_person'
  personId: string
  role: JobRole
  isPrimary?: boolean
}
interface ContactNew {
  kind: 'new_person'
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  title?: string | null
  source?: string | null
  role: JobRole
  isPrimary?: boolean
}
type ContactDecision = ContactExisting | ContactNew

interface ResolvedItemInput {
  description: string
  quantity?: number
  rate?: number
  rateType?: RateType
  department?: LineItemDepartment
  qualifier?: string | null
  inventoryItemId?: string | null
  assetCategoryId?: string | null
  catalogType?: 'INVENTORY' | 'ASSET_CATEGORY' | 'PACKAGE' | null
  pickupDate?: string | null
  returnDate?: string | null
  billableDays?: number | null
  notes?: string | null
  packageInstanceId?: string | null
  packageId?: string | null
  isPackageHeader?: boolean
  isPackageModified?: boolean
}

interface FromParseBody {
  companyDecision: CompanyDecision
  jobDecision: JobDecision
  contactsDecision?: ContactDecision[]
  items: ResolvedItemInput[]
  parsed?: {
    startDate?: string | null
    endDate?: string | null
    notes?: string | null
    productionName?: string | null
  }
  discount?: { amount: number; label?: string | null }
}

interface Warning {
  lineDescription: string
  reason: string
}

function resolveLineType(
  itemType: 'INVENTORY' | 'ASSET_CATEGORY' | 'PACKAGE' | null | undefined,
  department: LineItemDepartment,
): LineItemType {
  if (itemType === 'ASSET_CATEGORY') return 'VEHICLE'
  if (itemType === 'PACKAGE') return 'EQUIPMENT'
  if (department === 'EXPENDABLES') return 'EXPENDABLE'
  return 'EQUIPMENT'
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const callingUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!callingUser) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  let body: FromParseBody
  try {
    body = await req.json() as FromParseBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { companyDecision, jobDecision, contactsDecision, items, parsed, discount } = body
  if (!companyDecision || !jobDecision) {
    return NextResponse.json({ error: 'companyDecision + jobDecision required' }, { status: 400 })
  }
  // Empty items[] is valid (blank-mode wizard creates an empty DRAFT
  // and the rep adds lines on /orders/[id]). Just normalize the array
  // shape so the loop below is a no-op when nothing was parsed.
  const itemsSafe = Array.isArray(items) ? items : []

  // Order date range (inherited by lines that don't specify their own).
  // Inverted-range guard mirrors POST /api/orders.
  const orderStart = parsed?.startDate ? new Date(parsed.startDate) : null
  const orderEnd = parsed?.endDate ? new Date(parsed.endDate) : null
  if (
    orderStart && orderEnd &&
    Number.isFinite(orderStart.getTime()) && Number.isFinite(orderEnd.getTime()) &&
    orderEnd.getTime() < orderStart.getTime()
  ) {
    return NextResponse.json(
      {
        error: 'invalid date range',
        reason: `Order end date (${orderEnd.toISOString().slice(0, 10)}) is before start date (${orderStart.toISOString().slice(0, 10)}).`,
      },
      { status: 400 },
    )
  }

  try {
    const result = await prisma.$transaction(async (tx: TxClient) => {
      const warnings: Warning[] = []

      // 1) Company — resolve or create.
      let companyId: string
      let companyCreated = false
      if (companyDecision.kind === 'existing') {
        const co = await tx.company.findUnique({
          where: { id: companyDecision.companyId },
          select: { id: true },
        })
        if (!co) throw new Error(`company ${companyDecision.companyId} not found`)
        companyId = co.id
      } else {
        if (!companyDecision.name?.trim()) throw new Error('new company name required')
        const created = await tx.company.create({
          data: {
            name: companyDecision.name.trim(),
            tier: companyDecision.tier ?? 'NEW',
            billingEmail: companyDecision.billingEmail ?? null,
          },
          select: { id: true },
        })
        companyId = created.id
        companyCreated = true
      }

      // 2) Job — resolve or create. POST /api/orders treats this as
      //    mandatory; mirror that.
      let jobId: string
      let jobCreated = false
      if (jobDecision.kind === 'existing') {
        const job = await tx.job.findUnique({
          where: { id: jobDecision.jobId },
          select: { id: true },
        })
        if (!job) throw new Error(`job ${jobDecision.jobId} not found`)
        jobId = job.id
      } else {
        if (!jobDecision.name?.trim()) throw new Error('new job name required')
        // Robust SR-JOB-NNNN generation (ignores malformed codes); lives
        // inside the tx so a failed Order rolls back the Job.
        const jobCode = await nextJobCode(tx)
        const created = await tx.job.create({
          data: {
            jobCode,
            name: jobDecision.name.trim(),
            companyId,
            agentId: callingUser.id,
            productionType: jobDecision.productionType ?? 'OTHER',
            productionTypeProfileId:
              typeof jobDecision.productionTypeProfileId === 'string' && jobDecision.productionTypeProfileId
                ? jobDecision.productionTypeProfileId
                : null,
            status: 'QUOTED',
            startDate: jobDecision.startDate ? new Date(jobDecision.startDate) : null,
            endDate: jobDecision.endDate ? new Date(jobDecision.endDate) : null,
            notes: jobDecision.notes ?? null,
            estimatedValue:
              jobDecision.estimatedValue == null || jobDecision.estimatedValue === ''
                ? null
                : Number(jobDecision.estimatedValue),
          },
          select: { id: true },
        })
        jobId = created.id
        jobCreated = true
      }

      // 3) Contacts — Persons first (create new ones), then JobContacts.
      //    Additive on existing jobs; the wizard is responsible for
      //    surfacing the existing roster so the rep doesn't double-add.
      if (Array.isArray(contactsDecision) && contactsDecision.length > 0) {
        for (const c of contactsDecision) {
          let personId: string
          if (c.kind === 'existing_person') {
            personId = c.personId
          } else {
            const person = await tx.person.create({
              data: {
                firstName: c.firstName.trim(),
                lastName: c.lastName.trim(),
                email: c.email.trim().toLowerCase(),
                phone: c.phone ?? null,
                rawTitle: c.title ?? null,
                source: c.source ?? 'quote_wizard',
              },
              select: { id: true },
            })
            personId = person.id
          }
          await tx.jobContact.create({
            data: {
              jobId,
              personId,
              role: c.role,
              isPrimary: !!c.isPrimary,
            },
          })
        }
      }

      // 4) Order — DRAFT by schema default. Order number from the
      //    daily counter; rolled back with the tx if anything below
      //    fails so no number gap.
      const orderNumber = await nextOrderNumber(tx)
      const order = await tx.order.create({
        data: {
          orderNumber,
          companyId,
          agentId: callingUser.id,
          jobId,
          description: parsed?.productionName?.trim() || null,
          startDate: orderStart,
          endDate: orderEnd,
          notes: parsed?.notes ?? null,
          taxRate: 0,
        },
        select: { id: true, bookingId: true },
      })

      // 5) Items — one OrderLineItem per ResolvedItem. The dept
      //    resolution + date fallback + days math mirrors POST
      //    /api/orders/[id]/line-items (kept inline here, small
      //    enough; the sync helpers ARE called rather than re-
      //    implemented). Capacity conflicts on VEHICLES/STAGES are
      //    captured as warnings — the line still gets created
      //    without a hold so the rep can resolve on /orders/[id].
      let sortOrder = 0
      for (const raw of itemsSafe) {
        const quantity = raw.quantity != null ? Math.max(1, Math.floor(Number(raw.quantity))) : 1
        const rateType = (raw.rateType ?? 'DAILY') as RateType
        // Sprint 1 — a parsed-PDF rate is an override REQUEST like any
        // client-sent rate: resolved against catalog truth, divergence
        // persists flagged + audit-logged (same path as line-items POST).
        const rr = await resolveLineRate({
          inventoryItemId: raw.inventoryItemId || null,
          assetCategoryId: raw.assetCategoryId || null,
          rateType,
          clientRate: raw.rate ?? 0,
          isPackageMember: !!(raw.packageInstanceId && !raw.isPackageHeader),
        }, tx)
        if (!rr) {
          throw new Error(`unparseable rate on parsed line "${raw.description}"`)
        }

        // Dept resolution — mirrors line-items POST. Catalog wins
        // when bound; else trust the AI-provided dept; PRO_SUPPLIES
        // as final fallback.
        let department: LineItemDepartment = raw.department ?? 'PRO_SUPPLIES'
        let truckSlug: string | null = null
        if (raw.inventoryItemId) {
          const inv = await tx.inventoryItem.findUnique({
            where: { id: raw.inventoryItemId }, select: { department: true },
          })
          if (inv) department = inv.department
        } else if (raw.assetCategoryId) {
          const ac = await tx.assetCategory.findUnique({
            where: { id: raw.assetCategoryId }, select: { department: true, slug: true },
          })
          if (ac) { department = ac.department; truckSlug = ac.slug }
        }

        // Dates — per-line override > order range > today/today.
        let pickupResolved: Date
        let returnResolved: Date
        if (raw.pickupDate && raw.returnDate) {
          pickupResolved = new Date(raw.pickupDate)
          returnResolved = new Date(raw.returnDate)
        } else if (orderStart && orderEnd) {
          pickupResolved = orderStart
          returnResolved = orderEnd
        } else {
          pickupResolved = new Date()
          returnResolved = pickupResolved
        }
        if (returnResolved.getTime() < pickupResolved.getTime()) {
          // Same inverted-range guard the POST line-items route
          // applies — fail the whole tx rather than persist bad data.
          throw new Error(
            `Return date (${returnResolved.toISOString().slice(0, 10)}) is before pickup date (${pickupResolved.toISOString().slice(0, 10)}) for "${raw.description}"`,
          )
        }

        // billableDays — explicit > computed > null.
        let days: number | null
        if (raw.billableDays != null && Number(raw.billableDays) > 0) {
          days = Math.floor(Number(raw.billableDays))
        } else if (raw.billableDays === null && !raw.pickupDate && !raw.returnDate) {
          days = null
        } else {
          // Cube/camera trucks use the half-day-ends + weekly-cap rule.
          days = estimateRentalDays(pickupResolved, returnResolved, truckSlug)
        }

        // Hold pre-flight for VEHICLES/STAGES lines. If the order has
        // a Booking AND the line has an assetCategoryId AND capacity
        // is short, we DEGRADE: still create the OrderLineItem, but
        // skip the BookingItem write and emit a warning. Pre-flight
        // never runs at this point for the typical from-parse case
        // (DRAFT order, bookingId === null) since holds only exist
        // post-booking — but the structure is here so a future flow
        // that ships a from-parse against a booked order doesn't
        // silently double-book.
        let canRunHoldSync = false
        const wantsHoldSync =
          (department === 'VEHICLES' || department === 'STAGES') &&
          raw.assetCategoryId &&
          order.bookingId
        if (wantsHoldSync && raw.assetCategoryId && order.bookingId) {
          const feas = await checkHoldFeasibility({
            tx,
            categoryId: raw.assetCategoryId,
            startDate: pickupResolved,
            endDate: returnResolved,
            deltaQty: quantity,
            excludeBookingId: order.bookingId,
          })
          if (feas.capacityClear) {
            canRunHoldSync = true
          } else {
            warnings.push({
              lineDescription: raw.description,
              reason: `Capacity conflict on ${department}: ${feas.conflicts.length} other booking(s) hold this category in the window — line created without a hold. Resolve on the order detail page.`,
            })
          }
        }

        // Seed clientNote from InventoryItem when present.
        let seededNotes = raw.notes ?? null
        if (seededNotes == null && raw.inventoryItemId) {
          const invForNote = await tx.inventoryItem.findUnique({
            where: { id: raw.inventoryItemId }, select: { clientNote: true },
          })
          if (invForNote?.clientNote?.trim()) seededNotes = invForNote.clientNote
        }

        const lineTotal = computeLineTotal({
          quantity, rate: rr.rate.toNumber(), billableDays: days, rateType, department,
        })

        const line = await tx.orderLineItem.create({
          data: {
            orderId: order.id,
            sortOrder: sortOrder++,
            type: resolveLineType(raw.catalogType, department),
            description: raw.description,
            inventoryItemId: raw.inventoryItemId || null,
            assetCategoryId: raw.assetCategoryId || null,
            pickupDate: pickupResolved,
            returnDate: returnResolved,
            rateType,
            rate: rr.rate,
            resolvedRate: rr.resolvedRate,
            rateOverridden: rr.rateOverridden,
            quantity,
            billableDays: days,
            lineTotal: Math.round(lineTotal * 100) / 100,
            notes: seededNotes,
            department,
            qualifier: raw.qualifier ?? null,
            packageInstanceId: raw.packageInstanceId || null,
            packageId: raw.packageId || null,
            isPackageHeader: !!raw.isPackageHeader,
            isPackageModified: !!raw.isPackageModified,
          },
          select: { id: true },
        })

        // Rate-override audit row — inside the tx so it can't outlive a
        // rolled-back order.
        if (rr.rateOverridden && rr.resolvedRate) {
          await logRateOverride(tx, {
            orderId: order.id,
            orderLineItemId: line.id,
            resolvedRate: rr.resolvedRate,
            overrideRate: rr.rate,
            rateType,
            userId: callingUser.id,
          })
        }

        // Pick-list sync — fires for all lines. WAREHOUSE-routed
        // get a PickListItem (if/when a PickList exists, which only
        // happens post-book); FLEET/STAGE just stamp the lane.
        await syncPickListOnLineAdd(tx, {
          orderId: order.id,
          orderLineItemId: line.id,
          department,
        })

        // Hold sync — only when capacity was clear AND the line is
        // hold-tracked. Conflicting lines were warned above and
        // skipped here.
        if (canRunHoldSync && raw.assetCategoryId && order.bookingId) {
          await syncHoldOnLineAdd(tx, {
            bookingId: order.bookingId,
            categoryId: raw.assetCategoryId,
            addedQty: quantity,
          })
        }
      }

      // 6) Optional order-level discount line.
      if (discount && Number(discount.amount) !== 0) {
        const amt = -Math.abs(Number(discount.amount))
        await tx.orderLineItem.create({
          data: {
            orderId: order.id,
            sortOrder: sortOrder++,
            type: 'DISCOUNT',
            description: discount.label?.trim() || 'Discount',
            rate: amt,
            quantity: 1,
            rateType: 'FLAT',
            billableDays: 1,
            lineTotal: amt,
            department: 'PRO_SUPPLIES',
            pickupDate: orderStart ?? new Date(),
            returnDate: orderEnd ?? orderStart ?? new Date(),
          },
        })
      }

      return { orderId: order.id, jobCreated, companyCreated, companyId, warnings }
    })

    // Post-tx: self-healing totals recompute against canonical
    // line fields. recalcOrderTotals uses the singleton `prisma`
    // client (no tx parameter), so it runs AFTER the tx commits.
    // Pattern matches the existing POST line-items route.
    try {
      await recalcOrderTotals(result.orderId)
    } catch (err) {
      console.warn('[orders/from-parse] recalc totals failed:', err)
    }

    // Post-tx: refresh the Company's most-common production-type
    // profile cache when we minted a new Job under it. Same hygiene
    // POST /api/orders runs.
    if (result.jobCreated) {
      try {
        await recomputeMostCommonProductionTypeProfile(result.companyId)
      } catch (err) {
        console.warn('[orders/from-parse] recompute most-common profile failed:', err)
      }
    }

    return NextResponse.json(
      { orderId: result.orderId, warnings: result.warnings },
      { status: 201 },
    )
  } catch (err) {
    console.error('[orders/from-parse] tx failed:', err)
    const message = err instanceof Error ? err.message : 'create failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
