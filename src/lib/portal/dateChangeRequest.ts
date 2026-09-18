/**
 * "We need to move the pickup" — the client's ask, captured.
 *
 * ── Why a request and not an edit ──────────────────────────────────────
 * Moving an order's dates re-prices every line, re-stamps every unit the
 * order holds (src/lib/scheduling/followLineDates.ts) and can collide with
 * another production that already has the truck. "Change dates…" exists
 * precisely so a rep sees that cascade — the totals delta, the conflicts,
 * the custom-dated lines — before anything writes. None of that can be put
 * in front of a client, and the standing rule (Wes 2026-09-11) is that a
 * client's words never change a job on their own: "any changes to HQ are
 * gated with a confirmation or suggestion." So the portal takes the ask and
 * a person applies it through the control that already exists.
 *
 * ── One open ask per order ─────────────────────────────────────────────
 * `recordDateChangeRequest` REPLACES the open one rather than stacking a
 * second: a client who sends "the 16th", thinks again and sends "the 17th"
 * has changed their mind, not asked twice, and a desk reading two rows
 * cannot tell which is current. The superseded row is stamped resolved with
 * reason SUPERSEDED, never deleted — what they asked for first is part of
 * the conversation.
 *
 * ── The ask never outlives its answer ──────────────────────────────────
 * `listOpenDateChangeRequests` drops any row whose dates the order already
 * carries (`alreadySatisfied`), on top of the resolvedAt stamp. Stamping on
 * apply is best-effort bookkeeping; the derived filter is what guarantees
 * the queue cannot ask a rep to make a change that has already been made —
 * including one made by a different route, or by hand.
 *
 * ── Fails soft until the table exists ──────────────────────────────────
 * The table is created by "Add the client date-change request table" on
 * /admin/maintenance (or `npx tsx scripts/add-date-change-request-table.ts`).
 * Until then every READ here answers empty and the portal simply does not
 * offer the form — nothing else on the page is affected. A WRITE says so,
 * naming the task, rather than 500-ing at a client.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  alreadySatisfied,
  toDay,
  windowDrifted,
  type DayString,
} from '@/lib/portal/dateChangeRules'

export const DATE_CHANGE_TABLE_HINT =
  'The date-change request table is not in the database yet — an admin runs "Add the client date-change request table" on /admin/maintenance (or `npx tsx scripts/add-date-change-request-table.ts`).'

export function isMissingDateChangeTable(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === 'P2021' || err.code === 'P2022')
  )
}

export interface DateChangeRequestRow {
  id: string
  orderId: string
  orderNumber: string
  jobId: string | null
  jobCode: string | null
  jobName: string | null
  companyName: string | null
  requestedByName: string | null
  requestedByEmail: string | null
  /** What the order said when they asked. */
  askedStart: DayString | null
  askedEnd: DayString | null
  /** What they want. Either may be null — see the model. */
  requestedStart: DayString | null
  requestedEnd: DayString | null
  note: string | null
  createdAt: Date
  /** What the order says NOW — the two may have diverged since. */
  currentStart: DayString | null
  currentEnd: DayString | null
  /** The order moved since they asked. Rendered as a warning, never a block. */
  drifted: boolean
  agentId: string | null
  agentName: string | null
  /** Pickup day, for the action item's urgency. */
  pickupAt: Date | null
}

/** The open ask on this order, if any. Null when the table is absent. */
export async function findOpenDateChangeRequest(orderId: string): Promise<{
  id: string
  createdAt: Date
  requestedStart: DayString | null
  requestedEnd: DayString | null
  note: string | null
  requestedByName: string | null
} | null> {
  try {
    const row = await prisma.orderDateChangeRequest.findFirst({
      where: { orderId, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        requestedStartDate: true,
        requestedEndDate: true,
        note: true,
        requestedByName: true,
      },
    })
    if (!row) return null
    return {
      id: row.id,
      createdAt: row.createdAt,
      requestedStart: toDay(row.requestedStartDate),
      requestedEnd: toDay(row.requestedEndDate),
      note: row.note,
      requestedByName: row.requestedByName,
    }
  } catch (err) {
    if (isMissingDateChangeTable(err)) return null
    throw err
  }
}

/**
 * Record the ask, superseding whatever was open on this order.
 *
 * Throws a plain Error naming the maintenance task when the table is
 * missing — the caller turns that into a 503 the client can act on
 * ("call your rep"), which is honest, where a silent success would not be.
 */
export async function recordDateChangeRequest(args: {
  orderId: string
  jobId: string | null
  personId: string | null
  name: string | null
  email: string | null
  currentStart: DayString | null
  currentEnd: DayString | null
  requestedStart: DayString | null
  requestedEnd: DayString | null
  note: string | null
  source?: string
}): Promise<{ id: string; createdAt: Date; supersededId: string | null }> {
  const day = (v: DayString | null) => (v ? new Date(`${v}T00:00:00.000Z`) : null)

  try {
    return await prisma.$transaction(async (tx) => {
      const open = await tx.orderDateChangeRequest.findFirst({
        where: { orderId: args.orderId, resolvedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (open) {
        await tx.orderDateChangeRequest.update({
          where: { id: open.id },
          data: { resolvedAt: new Date(), resolvedReason: 'SUPERSEDED' },
        })
      }
      const row = await tx.orderDateChangeRequest.create({
        data: {
          orderId: args.orderId,
          jobId: args.jobId,
          requestedByPersonId: args.personId,
          requestedByName: args.name?.trim() || null,
          requestedByEmail: args.email?.trim().toLowerCase() || null,
          currentStartDate: day(args.currentStart),
          currentEndDate: day(args.currentEnd),
          requestedStartDate: day(args.requestedStart),
          requestedEndDate: day(args.requestedEnd),
          note: args.note?.trim() || null,
          source: args.source ?? 'JOB_PORTAL',
        },
        select: { id: true, createdAt: true },
      })
      return { ...row, supersededId: open?.id ?? null }
    })
  } catch (err) {
    if (isMissingDateChangeTable(err)) throw new Error(DATE_CHANGE_TABLE_HINT)
    throw err
  }
}

/**
 * Close every open ask on an order. Called when a rep applies the dates
 * (/dates/apply) and when one is closed by hand from the order page.
 *
 * Best-effort by design: a missing table, or a resolve that races another,
 * must never fail the date change itself — the apply is the durable act.
 */
export async function resolveDateChangeRequests(args: {
  orderId: string
  reason: string
  byUserId?: string | null
}): Promise<number> {
  try {
    const res = await prisma.orderDateChangeRequest.updateMany({
      where: { orderId: args.orderId, resolvedAt: null },
      data: {
        resolvedAt: new Date(),
        resolvedReason: args.reason,
        resolvedById: args.byUserId ?? null,
      },
    })
    return res.count
  } catch (err) {
    if (isMissingDateChangeTable(err)) return 0
    throw err
  }
}

/** Close ONE ask by id, scoped to its order so a guessed id cannot reach
 *  another production's row. Returns false when it was already closed. */
export async function resolveOneDateChangeRequest(args: {
  id: string
  orderId: string
  reason: string
  byUserId?: string | null
}): Promise<boolean> {
  try {
    const res = await prisma.orderDateChangeRequest.updateMany({
      where: { id: args.id, orderId: args.orderId, resolvedAt: null },
      data: {
        resolvedAt: new Date(),
        resolvedReason: args.reason,
        resolvedById: args.byUserId ?? null,
      },
    })
    return res.count > 0
  } catch (err) {
    if (isMissingDateChangeTable(err)) return false
    throw err
  }
}

const ROW_SELECT = {
  id: true,
  orderId: true,
  jobId: true,
  requestedByName: true,
  requestedByEmail: true,
  currentStartDate: true,
  currentEndDate: true,
  requestedStartDate: true,
  requestedEndDate: true,
  note: true,
  createdAt: true,
  order: {
    select: {
      orderNumber: true,
      startDate: true,
      endDate: true,
      status: true,
      agentId: true,
      agent: { select: { name: true } },
      company: { select: { name: true } },
      job: { select: { jobCode: true, name: true } },
    },
  },
} satisfies Prisma.OrderDateChangeRequestSelect

type RawRow = Prisma.OrderDateChangeRequestGetPayload<{ select: typeof ROW_SELECT }>

function shape(r: RawRow): DateChangeRequestRow {
  const currentStart = toDay(r.order.startDate)
  const currentEnd = toDay(r.order.endDate)
  const askedStart = toDay(r.currentStartDate)
  const askedEnd = toDay(r.currentEndDate)
  return {
    id: r.id,
    orderId: r.orderId,
    orderNumber: r.order.orderNumber,
    jobId: r.jobId,
    jobCode: r.order.job?.jobCode ?? null,
    jobName: r.order.job?.name ?? null,
    companyName: r.order.company?.name ?? null,
    requestedByName: r.requestedByName,
    requestedByEmail: r.requestedByEmail,
    askedStart,
    askedEnd,
    requestedStart: toDay(r.requestedStartDate),
    requestedEnd: toDay(r.requestedEndDate),
    note: r.note,
    createdAt: r.createdAt,
    currentStart,
    currentEnd,
    drifted: windowDrifted(
      { start: askedStart, end: askedEnd },
      { start: currentStart, end: currentEnd },
    ),
    agentId: r.order.agentId,
    agentName: r.order.agent?.name ?? null,
    pickupAt: r.order.startDate,
  }
}

/** The open ask on this order, fully shaped for the order page. */
export async function openRequestForOrder(orderId: string): Promise<DateChangeRequestRow | null> {
  try {
    const row = await prisma.orderDateChangeRequest.findFirst({
      where: { orderId, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      select: ROW_SELECT,
    })
    if (!row) return null
    const shaped = shape(row)
    // Already done — by this route or another. Don't ask twice.
    if (
      alreadySatisfied(
        { start: shaped.requestedStart, end: shaped.requestedEnd },
        { start: shaped.currentStart, end: shaped.currentEnd },
      )
    ) {
      return null
    }
    return shaped
  } catch (err) {
    if (isMissingDateChangeTable(err)) return null
    throw err
  }
}

/**
 * Every open ask, minus the ones the order has already outgrown.
 *
 * Bounded: cancelled and closed orders are dropped (a request against a
 * dead order is not work), and the newest 200 are read — a queue longer
 * than that is a different problem from the one this list solves.
 */
export async function listOpenDateChangeRequests(): Promise<DateChangeRequestRow[]> {
  try {
    const rows = await prisma.orderDateChangeRequest.findMany({
      where: {
        resolvedAt: null,
        order: { status: { notIn: ['CANCELLED', 'CLOSED'] } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: ROW_SELECT,
    })
    return rows
      .map(shape)
      .filter(
        (r) =>
          !alreadySatisfied(
            { start: r.requestedStart, end: r.requestedEnd },
            { start: r.currentStart, end: r.currentEnd },
          ),
      )
  } catch (err) {
    if (isMissingDateChangeTable(err)) return []
    throw err
  }
}
