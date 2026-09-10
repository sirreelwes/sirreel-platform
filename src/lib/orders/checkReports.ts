/**
 * Order check-out / check-in reports — the shared reads and the submit.
 *
 * Hugo, 2026-09-03: the warehouse prefers to pull on PAPER. When the
 * associate has finished prepping and loading, they carry the marked-up
 * sheet to a supervisor (Albert, Carlos, Hugo, Pedro) who types it in
 * here. So the report is a transcription of a document that already
 * exists, and the shape of this module follows from that:
 *
 *   - It never invents work. The draft is the order's own lines, in the
 *     order they are on the order, with `actual` pre-filled to what was
 *     ordered — because the overwhelmingly common case is "it all went",
 *     and a supervisor with 40 lines to enter should only be touching
 *     the ones that differ.
 *   - It is the yard's ONLY way to change an order (same meeting: "there
 *     are last minute exchanges and modifications that will need to be
 *     done to the order based on the check out report. This should be
 *     done and modify the order and flag back to the sales agent").
 *     Creating orders stays with sales — see canCreateOrders().
 *   - A changed line writes through to the OrderLineItem AND raises
 *     `changedOrder`, which is what puts it in front of the agent.
 *
 * Deliberately separate from PickList: that models a scan-driven pick
 * session, exists only for WAREHOUSE-lane lines on booked orders, and is
 * the workflow the floor has chosen not to run. See the schema comment
 * on OrderCheckReport.
 */

import type {
  LineItemPickStatus, OrderCheckEdge, OrderCheckLineChange, OrderStatus, PickListStatus, Prisma,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { classifyCheckLine, describeCheckChange } from '@/lib/orders/checkLineChange'
import { recalcOrderTotals } from '@/lib/orders'
import { settleJobReturnSafe } from '@/lib/fleet/settleJobReturn'
import { pacificYmd, ymdToDbDate } from '@/lib/fleet/todayBoard'
import { recomputeAndMaybeAdvanceLoadReady } from '@/lib/orders/loadReadyRollup'
import { advanceOneOrderToOnJob, ordersCarriedByBooking, projectOnJob } from '@/lib/orders/onJobFromVehicleOut'
import { advanceOneOrderToReturned, projectReturned } from '@/lib/orders/returnedFromCheckIn'

/**
 * Orders a check report can be filed against.
 *
 * Wes, 2026-09-03: "we need to have orders in their quote form show up
 * there because they don't get flipped to invoice until later, usually
 * after vehicle and order are returned."
 *
 * The first cut of this list was BOOKED-and-later, on the reasoning that
 * an unbooked order has nothing to load. That is wrong about how SirReel
 * actually runs: the paperwork on the truck is routinely still a QUOTE,
 * and the status catches up days after the gear is back. Gating on
 * status meant the sheet a supervisor was physically holding had no row
 * to type it into — the exact gap this surface exists to close.
 *
 * So the rule is about whether the order is ALIVE, not how far along it
 * is. Excluded:
 *   - CANCELLED / CLOSED — finished or called off; a count sheet must
 *     not quietly edit either.
 *   - quoteStatus LOST — a dead quote is not going anywhere. Handled by
 *     the where-clause below, since it lives on the other status axis.
 *
 * DRAFT is IN deliberately. A half-written order with real dates is
 * exactly the state a rush job is in at 6am.
 */
export const REPORTABLE_ORDER_STATUSES = [
  'DRAFT', 'QUOTE_SENT', 'APPROVED',
  'BOOKED', 'LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK',
  // Kept so a late correction still has somewhere to land. CLOSED is
  // not — by then the money is settled.
  'INVOICED',
] as const

/** How far the list reaches. Backward so a sheet that never got typed
 *  in stays on screen; forward so tomorrow can be prepped today. */
/** Statuses that mean "the paperwork is still a quote". */
const PRE_BOOKED_STATUSES: ReadonlySet<string> = new Set(['DRAFT', 'QUOTE_SENT', 'APPROVED'])

export const REPORT_DAYS_BACK = 3
export const REPORT_DAYS_FORWARD = 4

export interface ReportListRow {
  orderId: string
  orderNumber: string
  jobId: string
  jobName: string
  company: string
  /** Raw lifecycle status — the list says so when it is still a quote. */
  status: string
  /** True while the order has not been booked. Not a blocker; the crew
   *  should just know what document they are writing against. */
  preBooked: boolean
  /** The Pacific day this edge falls on. */
  ymd: string
  lineCount: number
  /** Filed report for this edge, if any. */
  filed: {
    submittedAt: Date
    preppedBy: string | null
    changedOrder: boolean
    /** The sheet covered only part of the order — the rest is still to
     *  go (or still to come back), so the row is not finished. */
    partial: boolean
    /** How many lines were left off it. */
    offSheet: number
  } | null
}

function dayWindow(): string[] {
  const days: string[] = []
  for (let i = -REPORT_DAYS_BACK; i <= REPORT_DAYS_FORWARD; i++) days.push(pacificYmd(i))
  return days
}

/**
 * Every order whose start (edge OUT) or end (edge IN) lands in the
 * window. Reads Order.startDate/endDate, which are a maintained mirror
 * of the line dates (syncOrderWindow) — never typed by a person, so
 * matching a day against them is safe. Same rule the yard board uses.
 */
export async function reportListFor(edge: OrderCheckEdge): Promise<ReportListRow[]> {
  const days = dayWindow()
  const dbDates = days.map(ymdToDbDate)

  const orders = await prisma.order.findMany({
    where: {
      status: { in: [...REPORTABLE_ORDER_STATUSES] },
      // A lost quote is not on a truck. This lives on the sales axis
      // (OrderQuoteStatus), not the lifecycle one, so it needs its own
      // clause rather than a status omission.
      quoteStatus: { not: 'LOST' },
      archivedAt: null,
      ...(edge === 'OUT' ? { startDate: { in: dbDates } } : { endDate: { in: dbDates } }),
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      startDate: true,
      endDate: true,
      jobId: true,
      job: { select: { name: true } },
      company: { select: { name: true } },
      _count: { select: { lineItems: true } },
      checkReports: {
        where: { edge },
        select: {
          submittedAt: true, preppedBy: true, changedOrder: true, partial: true,
          lines: { where: { onSheet: false }, select: { id: true } },
        },
      },
    },
    orderBy: edge === 'OUT' ? { startDate: 'asc' } : { endDate: 'asc' },
  })

  return orders.map((o) => {
    const d = edge === 'OUT' ? o.startDate : o.endDate
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      jobId: o.jobId,
      jobName: o.job?.name || 'Unnamed job',
      company: o.company?.name || 'Unknown company',
      status: o.status,
      preBooked: PRE_BOOKED_STATUSES.has(o.status),
      // @db.Date is stored at UTC midnight — format in UTC or it prints
      // the previous day west of Greenwich.
      ymd: d ? d.toISOString().slice(0, 10) : '',
      lineCount: o._count.lineItems,
      filed: o.checkReports[0]
        ? {
            submittedAt: o.checkReports[0].submittedAt,
            preppedBy: o.checkReports[0].preppedBy,
            changedOrder: o.checkReports[0].changedOrder,
            partial: o.checkReports[0].partial,
            offSheet: o.checkReports[0].lines.length,
          }
        : null,
    }
  })
}

export interface DraftLine {
  orderLineItemId: string
  description: string
  qualifier: string | null
  lane: string | null
  expectedQty: number
  /** What a previously filed report recorded, when re-opening one. */
  actualQty: number
  change: OrderCheckLineChange
  substituteFor: string | null
  note: string | null
  /** False when a previous partial pull left this line off the sheet.
   *  Re-opening the report shows it still waiting rather than counted. */
  onSheet: boolean
}

export interface ReportDraft {
  orderId: string
  orderNumber: string
  jobId: string
  jobName: string
  company: string
  status: string
  preBooked: boolean
  startDate: string | null
  endDate: string | null
  agentName: string | null
  edge: OrderCheckEdge
  filed: {
    submittedAt: string
    preppedBy: string | null
    notes: string | null
    changedOrder: boolean
    partial: boolean
    sheetPhotoUrl: string | null
  } | null
  preppedBy: string
  notes: string
  lines: DraftLine[]
  /** Rows a previous report ADDED that are not order lines. */
  extras: Array<{ description: string; actualQty: number; note: string | null; filed?: boolean }>
}

/**
 * The form's starting state: the order's lines, plus whatever a previous
 * submission recorded. Re-opening a filed report shows what was entered,
 * not a blank sheet — a correction is the second most common reason to
 * open this screen.
 */
export async function reportDraft(orderId: string, edge: OrderCheckEdge): Promise<ReportDraft | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      startDate: true,
      endDate: true,
      jobId: true,
      job: { select: { name: true } },
      company: { select: { name: true } },
      agent: { select: { name: true } },
      lineItems: {
        select: {
          id: true, description: true, qualifier: true,
          quantity: true, fulfillmentLane: true, sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
      checkReports: {
        where: { edge },
        select: {
          submittedAt: true, preppedBy: true, notes: true, changedOrder: true,
          partial: true, sheetPhotoUrl: true,
          lines: {
            select: {
              orderLineItemId: true, description: true, expectedQty: true,
              actualQty: true, change: true, substituteFor: true, note: true,
              onSheet: true,
            },
          },
        },
      },
    },
  })
  if (!order) return null

  const prior = order.checkReports[0] ?? null
  const priorByLine = new Map(
    (prior?.lines ?? []).filter((l) => l.orderLineItemId).map((l) => [l.orderLineItemId as string, l]),
  )

  const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    jobId: order.jobId,
    jobName: order.job?.name || 'Unnamed job',
    company: order.company?.name || 'Unknown company',
    status: order.status,
    preBooked: PRE_BOOKED_STATUSES.has(order.status),
    startDate: ymd(order.startDate),
    endDate: ymd(order.endDate),
    agentName: order.agent?.name ?? null,
    edge,
    filed: prior
      ? {
          submittedAt: prior.submittedAt.toISOString(),
          preppedBy: prior.preppedBy,
          notes: prior.notes,
          changedOrder: prior.changedOrder,
          partial: prior.partial,
          sheetPhotoUrl: prior.sheetPhotoUrl,
        }
      : null,
    preppedBy: prior?.preppedBy ?? '',
    notes: prior?.notes ?? '',
    lines: order.lineItems.map((li) => {
      const p = priorByLine.get(li.id)
      return {
        orderLineItemId: li.id,
        description: li.description,
        qualifier: li.qualifier,
        lane: li.fulfillmentLane,
        expectedQty: li.quantity,
        // Pre-filled to "it all went" — the supervisor only touches the
        // exceptions. A blank column would make every line a decision.
        actualQty: p ? p.actualQty : li.quantity,
        change: p ? p.change : 'NONE',
        // Re-opening a partial: the lines that stayed on the shelf come
        // back still off the sheet, so the second pull starts where the
        // first one stopped instead of re-counting what already went.
        onSheet: p ? p.onSheet : true,
        substituteFor: p?.substituteFor ?? null,
        note: p?.note ?? null,
      }
    }),
    // `filed: true` marks an addition the previous submission already
    // recorded and already flagged to the agent. Without it the form
    // reads its own filed additions back as fresh differences — and an
    // addition can never be reconciled against the order, so the report
    // never reaches a settled state: file, reopen, the same two rows
    // still "differ", file again. That is the loop Jose hit.
    extras: (prior?.lines ?? [])
      .filter((l) => !l.orderLineItemId)
      .map((l) => ({ description: l.description, actualQty: l.actualQty, note: l.note, filed: true })),
  }
}

export interface SubmitLineInput {
  orderLineItemId: string | null
  description: string
  expectedQty: number
  actualQty: number
  substituteFor?: string | null
  note?: string | null
  /**
   * False = this line was NOT part of this pull. Defaults true.
   *
   * The distinction it draws is the whole point of partial sheets: a
   * line at zero because it stayed on the shelf for tomorrow is not a
   * line the client didn't get. Without it the only way to file a half
   * pull was to type zeros, which classifies as REMOVED, zeroes the
   * quantity on the order and emails the client a shrunken quote.
   */
  onSheet?: boolean
}

export interface SubmitResult {
  reportId: string
  /** Something on the sheet needs the AGENT — a moved quantity OR an
   *  added row they have to price. Drives the action item. */
  changedOrder: boolean
  /** The order's own lines were actually rewritten. Narrower than
   *  `changedOrder`, because an added row never touches the order.
   *  This is what may email the client, so it must not be widened. */
  orderLinesChanged: boolean
  /** Human-readable list of what changed, for the audit row + the flag. */
  changes: string[]
  /** The sheet covered only part of the order. */
  partial: boolean
  /** Lines left off it — still to pull, or still to come back. */
  offSheet: number
}

// The classifier and its wording now live in checkLineChange.ts, with no
// prisma import, so the supervisor's screen can read a change back in the
// same words this module writes. Re-exported: it is still part of this
// module's surface for the test and the route.
export { classifyCheckLine, describeCheckChange }

/**
 * File the report and, on the OUT edge, write its differences onto the
 * order.
 *
 * Why only OUT changes the order: the check-OUT sheet records what the
 * client actually received, which is what they are billed for. The
 * check-IN sheet records what came back — a shortfall there is a
 * missing-gear problem, not a change to what was rented, and quietly
 * reducing a booked line because a case did not return would credit the
 * client for losing our equipment. So IN is recorded and flagged, never
 * applied.
 */
export async function submitCheckReport(opts: {
  orderId: string
  edge: OrderCheckEdge
  submittedById: string
  preppedBy: string | null
  notes: string | null
  lines: SubmitLineInput[]
  /** Private-blob key + url of the photographed paper sheet, if one was
   *  taken. The paper is the source document; once the counts are typed
   *  in this is the only thing that still shows what was written. */
  sheetPhotoKey?: string | null
  sheetPhotoUrl?: string | null
}): Promise<SubmitResult> {
  const { orderId, edge, submittedById, preppedBy, notes, lines } = opts

  // A line that was not on this sheet is not a count at all — it is
  // silence about that line. Classify only what the paper actually
  // spoke to; everything else is recorded as untouched (change NONE,
  // actual = expected) so nothing downstream reads a zero and
  // concludes the client didn't get it.
  const classified = lines.map((l) => {
    const onSheet = l.onSheet !== false
    return {
      ...l,
      onSheet,
      actualQty: onSheet ? l.actualQty : l.expectedQty,
      change: onSheet ? classifyCheckLine(l) : ('NONE' as OrderCheckLineChange),
    }
  })
  const offSheet = classified.filter((l) => !l.onSheet).length
  const partial = offSheet > 0
  const differing = classified.filter((l) => l.change !== 'NONE')
  // `changedOrder` has to carry the AGENT flag — an added row needs
  // pricing just as much as a moved quantity — but it was also being
  // read as "the order's lines were rewritten", and those are not the
  // same fact. An ADDED row is deliberately never written onto the order
  // (the yard cannot see rates), so a report whose only difference is an
  // addition changed nothing, yet said it had: S260905-002 was filed
  // three times on 2026-09-08, twice with changedOrder true and not one
  // line moved. The client re-send is gated on it too, so a pre-booked
  // order would have emailed the client an "updated quote" identical to
  // the one they were already holding.
  const orderLinesChanged = edge === 'OUT' && differing.some((l) => l.orderLineItemId)
  const applyToOrder = edge === 'OUT' && differing.length > 0

  const changes: string[] = differing.map((l) => describeCheckChange(l, l.change))

  const reportId = await prisma.$transaction(async (tx) => {
    // Replace-in-place: one current report per edge (see the @@unique).
    // A re-count corrects the sheet rather than stacking a second
    // document that disagrees with the first.
    const existing = await tx.orderCheckReport.findUnique({
      where: { orderId_edge: { orderId, edge } },
      select: { id: true },
    })
    if (existing) {
      await tx.orderCheckReportLine.deleteMany({ where: { reportId: existing.id } })
    }

    const report = await tx.orderCheckReport.upsert({
      where: { orderId_edge: { orderId, edge } },
      create: {
        orderId, edge, submittedById, preppedBy, notes,
        sheetPhotoKey: opts.sheetPhotoKey ?? null,
        sheetPhotoUrl: opts.sheetPhotoUrl ?? null,
        changedOrder: applyToOrder,
        partial,
        // A re-submission that changes something is unacknowledged
        // again — the agent has to see the NEW state, not remember
        // having cleared the old one.
        agentAckedAt: null,
        agentAckedById: null,
      },
      update: {
        submittedById, preppedBy, notes,
        // A re-file without a new photo KEEPS the one on record — the
        // paper did not stop existing because someone corrected a digit.
        ...(opts.sheetPhotoKey
          ? { sheetPhotoKey: opts.sheetPhotoKey, sheetPhotoUrl: opts.sheetPhotoUrl ?? null }
          : {}),
        submittedAt: new Date(),
        changedOrder: applyToOrder,
        // A second pull re-files the same report with the remaining
        // lines ticked on — which is exactly how a partial becomes
        // complete. It must be able to go back to false.
        partial,
        agentAckedAt: null,
        agentAckedById: null,
      },
      select: { id: true },
    })

    await tx.orderCheckReportLine.createMany({
      data: classified.map((l) => ({
        reportId: report.id,
        orderLineItemId: l.orderLineItemId,
        description: l.description,
        expectedQty: l.expectedQty,
        actualQty: l.actualQty,
        change: l.change,
        onSheet: l.onSheet,
        substituteFor: l.substituteFor?.trim() || null,
        note: l.note?.trim() || null,
      })),
    })

    if (orderLinesChanged) {
      for (const l of differing) {
        if (!l.orderLineItemId) continue
        const data: Prisma.OrderLineItemUpdateInput = { quantity: l.actualQty }
        // A substitution renames the line rather than deleting and
        // re-adding it: the line keeps its rate, its dates and its
        // history, and the report holds what it used to say.
        if (l.change === 'SUBSTITUTE') data.description = l.description
        await tx.orderLineItem.update({ where: { id: l.orderLineItemId }, data })
      }
    }

    await tx.auditLog.create({
      data: {
        userId: submittedById,
        action: edge === 'OUT' ? 'order.check_out_report' : 'order.check_in_report',
        entityType: 'Order',
        entityId: orderId,
        oldValues: {},
        newValues: {
          reportId: report.id,
          preppedBy,
          lineCount: classified.length,
          changedOrder: applyToOrder,
          partial,
          offSheet,
          changes,
        },
      },
    })

    return report.id
  })

  // Totals move when quantities do. Outside the transaction because
  // recalcOrderTotals opens its own and refuses locked orders on its
  // own terms.
  if (orderLinesChanged) await recalcOrderTotals(orderId)

  return { reportId, changedOrder: applyToOrder, orderLinesChanged, changes, partial, offSheet }
}

/**
 * What a filed sheet means to the REST of HQ.
 *
 * The report is a transcription, and for its first day that is all it
 * was — which left a hole nobody could see from this file. The gear
 * lane's "is it settled" signal is `PickList.status`, and the only
 * thing that ever advanced it was the scan session the floor declined
 * to run. So a cart could be pulled, loaded, sent out and counted back
 * on paper while its pick list sat at DRAFT forever, which meant:
 *
 *   - the yard board's gear row read "Not started" all week, and
 *   - `settleJobReturn` never stamped `Job.returnedAt`, because it
 *     waits for every pick list to reach CHECKED_IN — so every job
 *     with gear on it drifted into a phantom "Not returned", the
 *     exact class of ghost Wes purged 54 of on 2026-08-28.
 *
 * A filed check-IN sheet IS the gear being counted back. Saying so here
 * is what makes the check-in button on the board mean something.
 *
 * Deliberately one-directional and guarded: it only advances a list
 * that has not got there yet, never regresses one, and never touches a
 * CANCELLED list. Filing a sheet cannot un-close anything.
 */
const OUT_NOT_YET: PickListStatus[] = ['DRAFT', 'PICKING', 'READY_TO_STAGE', 'STAGED']
const IN_NOT_YET: PickListStatus[] = [
  'DRAFT', 'PICKING', 'READY_TO_STAGE', 'STAGED', 'LOADED', 'CHECKING_IN',
]
/** Line states an outbound sheet may move forward. RETURNED / SHORT are
 *  the inbound pass and are never walked back to LOADED. */
const OUT_LINE_NOT_YET: LineItemPickStatus[] = ['PENDING_PICK', 'PICKED', 'STAGED']

export interface GearSettleResult {
  /** Whether this order's pick list moved (0 or 1 — one list per order). */
  pickListAdvanced: boolean
  /** Whether this sheet is what stamped Job.returnedAt. */
  jobReturned: boolean
  /** Whether this sheet is what advanced the ORDER to ON_JOB — i.e.
   *  whether the job now reads "On rental" because of it. */
  orderOut: boolean
  /** Whether this sheet is what advanced the ORDER to RETURNED — the
   *  inbound mirror, and what unblocks the money arc behind it
   *  (sendInvoice advances only from RETURNED). */
  orderReturned: boolean
  /** Why a complete OUTBOUND sheet did not put the order out, when it
   *  didn't. Null on the inbound edge, and null when it did.
   *
   *  Jose filed a sheet and asked what else had to happen; on a
   *  warehouse-only order the answer is now "nothing". On one with a
   *  truck on it there IS something, and the screen has to say what —
   *  otherwise the supervisor is back to hunting for a button. The
   *  fleet reasons deliberately do NOT offer to settle the lane from
   *  here: a vehicle leaves through the driver check-out and its
   *  walk-around, and a typed sheet is not a substitute for that
   *  (Wes, 2026-09-09). They name who can actually close it. */
  outBlocked: OutBlockedReason | null
}

/**
 * The reasons a complete outbound sheet stops short of ON_JOB. Each one
 * is a sentence the supervisor's screen can say, and each names the next
 * person or step rather than just reporting a failed guard.
 */
export type OutBlockedReason =
  /** Sheet is for a start day still ahead — a prep document, not a
   *  departure. The lanes moved; the order waits for the day. */
  | 'prep-for-a-later-day'
  /** Still in quote form. A sheet cannot book an order — booking
   *  snapshots money and routes lanes, and that is sales' work. */
  | 'not-booked'
  /** No truck that a check-out would route to THIS order. Either nothing
   *  is assigned on the job at all, or something is but the link does not
   *  reach here — which is the LW2 shape (S260908-004, 2026-09-09): the
   *  SuperCube was assigned all along (Cube 18, on its own booking), but
   *  Order.bookingId and BookingAssignment.orderId were both null, and
   *  with TWO live orders on the job ordersCarriedByBooking's
   *  one-live-order fallback could not guess. So a driver checking that
   *  truck out would have advanced nothing. Either way dispatch owns it:
   *  put a truck on the order, or link the one already holding it. */
  | 'fleet-no-vehicle-assigned'
  /** The truck is assigned but has not been checked out. That check-out
   *  — with its mileage and its 22-slot walk-around — is what closes
   *  the fleet lane. */
  | 'fleet-vehicle-not-checked-out'

export async function settleGearAfterReport(
  orderId: string,
  edge: OrderCheckEdge,
  userId: string,
  /** A partial sheet settles NOTHING: half the gear is still on the
   *  shelf (OUT) or still on the truck (IN). Closing the pick list here
   *  would tick the row green and, on the inbound edge, stamp the job
   *  returned while cases are still out. */
  partial = false,
): Promise<GearSettleResult> {
  if (partial) {
    return {
      pickListAdvanced: false, jobReturned: false, orderOut: false,
      orderReturned: false, outBlocked: null,
    }
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, status: true, jobId: true, startDate: true, bookingId: true },
  })

  const list = await prisma.pickList.findUnique({
    where: { orderId },
    select: { id: true, status: true },
  })

  const now = new Date()
  const nextStatus: PickListStatus = edge === 'OUT' ? 'LOADED' : 'CHECKED_IN'
  // updateMany with the status guard rather than update: two people
  // filing the same sheet, or a re-file over an already-closed list,
  // must not walk it backwards or re-stamp who closed it.
  const advanced = await prisma.pickList.updateMany({
    where: {
      orderId,
      status: { in: edge === 'OUT' ? OUT_NOT_YET : IN_NOT_YET },
    },
    data:
      edge === 'OUT'
        ? { status: nextStatus, completedAt: now }
        : { status: nextStatus, checkedInAt: now, checkedInById: userId },
  })

  // Nobody clicked a button in the pick session, so leave a record of
  // what moved the list and why.
  if (advanced.count > 0 && list) {
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'picklist.settled_by_check_report',
        entityType: 'PickList',
        entityId: list.id,
        oldValues: { status: list.status },
        newValues: { status: nextStatus, edge, orderId },
      },
    })
  }

  // The LINES, not just the list header. Jose, 2026-09-09 (Fox Sports /
  // S260909-002): he filed the check-out sheet and the order page still
  // read "0 / 3 loaded", because the authoritative lane state is
  // OrderLineItem.pickStatus and only the scan session ever wrote it.
  // The header said LOADED while every line under it said PENDING_PICK,
  // so the BOOKED → LOADED_READY rollup — which counts loaded lines —
  // could never fire either.
  //
  // A complete sheet speaks for every warehouse line on the order,
  // including one counted zero: that line is recorded SHORT on the
  // report and the floor has nothing left to do with it. (A PARTIAL
  // sheet returned above and touches none of this.)
  const outLines = edge === 'OUT'
    ? await prisma.orderLineItem.updateMany({
        where: { orderId, fulfillmentLane: 'WAREHOUSE', pickStatus: { in: OUT_LINE_NOT_YET } },
        data: { pickStatus: 'LOADED' },
      })
    : { count: 0 }

  // Only the inbound sheet can close a job out. Going out settles
  // nothing — the gear has just left.
  const settled = edge === 'IN'
    ? await settleJobReturnSafe(order?.jobId ?? null, userId)
    : { stamped: false }

  const out = edge === 'OUT' && order
    ? await settleOrderOut(order, userId, outLines.count)
    : { moved: false, blocked: null }
  const orderReturned = edge === 'IN' && order ? await settleOrderIn(order, userId) : false

  return {
    pickListAdvanced: advanced.count > 0,
    jobReturned: settled.stamped,
    orderOut: out.moved,
    orderReturned,
    outBlocked: out.blocked,
  }
}

/**
 * The outbound half of "what a filed sheet means to the rest of HQ":
 * BOOKED → LOADED_READY → ON_JOB.
 *
 * Jose again, same order: "Should this now say On Rental?" It should.
 * The job's operational state is DERIVED from its orders, and a
 * warehouse-only order has no truck, so neither of the two paths to
 * ON_JOB could reach it — the driver check-out never fires without a
 * vehicle, and the manual "Mark On Job" button only appears once an
 * order is already LOADED_READY, which the stalled rollup made
 * unreachable. The sheet was the only record that the gear had left,
 * and it was a dead end.
 *
 * Both steps are guarded and forward-only, so a re-filed correction is
 * a no-op rather than a second departure.
 *
 * The one thing a sheet does NOT do is book: an order still in quote
 * form stays there (ADVANCEABLE_TO_ON_JOB is BOOKED / LOADED_READY),
 * because booking snapshots money and routes lanes and the yard does
 * not price work. Same line the driver token respects.
 */
async function settleOrderOut(
  order: { id: string; orderNumber: string; status: OrderStatus; startDate: Date | null; jobId: string; bookingId: string | null },
  userId: string,
  linesLoaded: number,
): Promise<{ moved: boolean; blocked: OutBlockedReason | null }> {
  // Warehouse lane just went terminal, so re-run the rollup the picking
  // floor would have run. Idempotent, and a no-op when the fleet lane is
  // still pending — a truck that has not been stamped ready still gates
  // the order, exactly as it does from /warehouse/pick.
  let status = order.status
  let fleetPending = false
  try {
    const rollup = await recomputeAndMaybeAdvanceLoadReady(order.id)
    if (rollup.advanced) status = 'LOADED_READY'
    // The rollup already knows which lane is holding it up. Keep its
    // answer rather than re-deriving one that could disagree.
    else fleetPending = rollup.reason === 'fleet-pending' || rollup.reason === 'both-lanes-pending'
  } catch (err) {
    console.error('[check-report] LOADED_READY rollup failed:', err)
  }

  // The sheet reaches four days FORWARD (REPORT_DAYS_FORWARD) so a
  // supervisor can prep tomorrow's pull today. Filing one of those is
  // not gear leaving the yard, and putting the job on rental early would
  // start the client's in-progress cadence days before the pickup. So
  // the ON_JOB step waits for the day itself; the lane state above is
  // true either way. Order.startDate is the maintained mirror of the
  // line dates (syncOrderWindow) and is what the list matched on to put
  // this sheet on screen — @db.Date, so read the UTC calendar day.
  const startYmd = order.startDate ? order.startDate.toISOString().slice(0, 10) : null
  if (startYmd && startYmd > pacificYmd(0)) return { moved: false, blocked: 'prep-for-a-later-day' }

  const moved = await advanceOneOrderToOnJob(
    prisma, { ...order, status }, userId, 'gear-check-out-sheet', { linesLoaded: String(linesLoaded) },
  )
  // IN_PROGRESS on the cadence ladder. This clears unfired future events,
  // which drops the LOADED_AND_READY the rollup just scheduled — and that
  // is the right way round: that email tells a client their gear is ready
  // to collect, and this sheet says it already left.
  if (moved) {
    await projectOnJob([order.id])
    return { moved: true, blocked: null }
  }
  return { moved: false, blocked: await whyNotOut(order, status, fleetPending) }
}

/**
 * What is actually holding the order back, in terms of who can move it.
 *
 * Only called when the sheet was complete and the order still did not go
 * out, so every branch here is something a supervisor is entitled to be
 * told. A status past LOADED_READY returns null: the order is already
 * out (or beyond), and there is nothing to report.
 */
async function whyNotOut(
  order: { id: string; jobId: string },
  status: OrderStatus,
  fleetPending: boolean,
): Promise<OutBlockedReason | null> {
  if (PRE_BOOKED_STATUSES.has(status)) return 'not-booked'
  if (!fleetPending) return null

  // A FLEET line is waiting on a truck. Which sentence to say depends on
  // whether a truck would actually reach THIS order when it is checked
  // out — so ask the same helper the check-out itself asks, rather than
  // counting assignments across the job. Those are not the same question
  // on a multi-order job: SR-JOB-0308 carried a Video Van for one order
  // and a SuperCube for the other, and a job-wide count told the
  // supervisor of the SuperCube order that "the truck still has to be
  // checked out" on the strength of the Video Van.
  //
  // Reusing ordersCarriedByBooking is the point: it owns the bookingId
  // match AND the one-live-order fallback for an orphaned link, so this
  // message cannot drift from what a check-out will really do.
  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      bookingItem: { booking: { jobId: order.jobId, status: { not: 'CANCELLED' } } },
    },
    select: { bookingItem: { select: { bookingId: true } } },
  })
  const bookingIds = [...new Set(assignments.map((a) => a.bookingItem?.bookingId).filter((b): b is string => !!b))]
  for (const bookingId of bookingIds) {
    const carried = await ordersCarriedByBooking(prisma, order.jobId, bookingId)
    if (carried.some((o) => o.id === order.id)) return 'fleet-vehicle-not-checked-out'
  }
  return 'fleet-no-vehicle-assigned'
}

/**
 * The inbound half: whatever the order was, it is RETURNED now.
 *
 * The mirror of settleOrderOut, and the reason it exists is the same one
 * — the ORDER is what everything downstream reads, and until this the
 * inbound sheet advanced the pick list and Job.returnedAt while leaving
 * the order exactly where it was. S260905-002 was invoiced $630, sent to
 * the client, and still said BOOKED. See returnedFromCheckIn.ts for why
 * RETURNED (not LD_CHECK), and why a SHORT line still counts.
 *
 * No day gate here, deliberately — unlike the outbound edge. That one
 * waits for the start day because a sheet filed for tomorrow is a PREP
 * document and prepping a pull the day before is real, everyday work.
 * There is no equivalent for counting gear back: you cannot check in
 * cases that are not in front of you, and gear routinely comes home
 * early. The pick list and Job.returnedAt already move on any complete
 * inbound sheet with no date check, so gating only the status would make
 * the order disagree with its own job.
 */
async function settleOrderIn(
  order: { id: string; orderNumber: string; status: OrderStatus },
  userId: string,
): Promise<boolean> {
  const moved = await advanceOneOrderToReturned(
    prisma, order, userId, 'gear-check-in-sheet', { orderNumber: order.orderNumber },
  )
  // RETURNED on the cadence ladder plus the thank-you suggestion — the
  // same two things the manual status change on the order page does.
  // Sends nothing to the client; see projectReturned.
  if (moved) await projectReturned([order.id])
  return moved
}
