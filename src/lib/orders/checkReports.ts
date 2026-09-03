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

import type { OrderCheckEdge, OrderCheckLineChange, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recalcOrderTotals } from '@/lib/orders'
import { pacificYmd, ymdToDbDate } from '@/lib/fleet/todayBoard'

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
  filed: { submittedAt: Date; preppedBy: string | null; changedOrder: boolean } | null
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
        select: { submittedAt: true, preppedBy: true, changedOrder: true },
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
      filed: o.checkReports[0] ?? null,
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
  filed: { submittedAt: string; preppedBy: string | null; notes: string | null; changedOrder: boolean } | null
  preppedBy: string
  notes: string
  lines: DraftLine[]
  /** Rows a previous report ADDED that are not order lines. */
  extras: Array<{ description: string; actualQty: number; note: string | null }>
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
          lines: {
            select: {
              orderLineItemId: true, description: true, expectedQty: true,
              actualQty: true, change: true, substituteFor: true, note: true,
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
        substituteFor: p?.substituteFor ?? null,
        note: p?.note ?? null,
      }
    }),
    extras: (prior?.lines ?? [])
      .filter((l) => !l.orderLineItemId)
      .map((l) => ({ description: l.description, actualQty: l.actualQty, note: l.note })),
  }
}

export interface SubmitLineInput {
  orderLineItemId: string | null
  description: string
  expectedQty: number
  actualQty: number
  substituteFor?: string | null
  note?: string | null
}

export interface SubmitResult {
  reportId: string
  changedOrder: boolean
  /** Human-readable list of what changed, for the audit row + the flag. */
  changes: string[]
}

/** What kind of difference this row records. Derived, never trusted from
 *  the client — the classification drives what we write to the order.
 *  Exported for the test: this function decides whether a client gets
 *  billed differently, and the order of its branches is load-bearing. */
export function classifyCheckLine(line: SubmitLineInput): OrderCheckLineChange {
  if (!line.orderLineItemId) return 'ADDED'
  if (line.substituteFor && line.substituteFor.trim()) return 'SUBSTITUTE'
  if (line.actualQty === 0 && line.expectedQty > 0) return 'REMOVED'
  if (line.actualQty < line.expectedQty) return 'SHORT'
  if (line.actualQty > line.expectedQty) return 'EXTRA'
  return 'NONE'
}

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
}): Promise<SubmitResult> {
  const { orderId, edge, submittedById, preppedBy, notes, lines } = opts

  const classified = lines.map((l) => ({ ...l, change: classifyCheckLine(l) }))
  const differing = classified.filter((l) => l.change !== 'NONE')
  const applyToOrder = edge === 'OUT' && differing.length > 0

  const changes: string[] = differing.map((l) => {
    switch (l.change) {
      case 'SUBSTITUTE': return `${l.substituteFor} → ${l.description} (×${l.actualQty})`
      case 'ADDED':      return `added ${l.description} ×${l.actualQty}`
      case 'REMOVED':    return `did not send ${l.description}`
      default:           return `${l.description}: ${l.expectedQty} → ${l.actualQty}`
    }
  })

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
        changedOrder: applyToOrder,
        // A re-submission that changes something is unacknowledged
        // again — the agent has to see the NEW state, not remember
        // having cleared the old one.
        agentAckedAt: null,
        agentAckedById: null,
      },
      update: {
        submittedById, preppedBy, notes,
        submittedAt: new Date(),
        changedOrder: applyToOrder,
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
        substituteFor: l.substituteFor?.trim() || null,
        note: l.note?.trim() || null,
      })),
    })

    if (applyToOrder) {
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
          changes,
        },
      },
    })

    return report.id
  })

  // Totals move when quantities do. Outside the transaction because
  // recalcOrderTotals opens its own and refuses locked orders on its
  // own terms.
  if (applyToOrder) await recalcOrderTotals(orderId)

  return { reportId, changedOrder: applyToOrder, changes }
}
