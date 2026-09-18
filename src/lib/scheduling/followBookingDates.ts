/**
 * The ORDER follows the reservation's dates — the other half of
 * `followLineDates.ts`.
 *
 * Wes, 2026-09-18: "Every reservation should be locked to a line item on
 * an order. You should be able to edit the dates of the reservation and
 * have it adjust the order and vice versa."
 *
 * Only one direction existed. `POST /api/orders/[id]/dates/apply` and the
 * row editor push an order's dates onto the board (followLineDates), but
 * the gantt bar — dragged, or retyped in the drawer — wrote
 * `Booking.startDate/endDate` and its assignments and stopped there. The
 * order the reservation belongs to kept the old days, so the quote, the
 * pick list, the agreement's rental period and the invoice all still read
 * the week the rep had just moved off.
 *
 * What a reservation move means, per window:
 *
 *   · TRANSLATION (both edges move by the same number of days — every
 *     drag, and most drawer edits). The whole rental moved: every dated
 *     line, every unit and the order header shift by that delta. Day
 *     counts do not change, so NO money changes. That is the common case
 *     and it is deliberately the safe one.
 *   · RESIZE (the length changed). Only what touches the edge that moved
 *     follows: a line starting on the old start gets the new start, one
 *     ending on the old end gets the new end. An interior block — the
 *     second leg of a two-block order — is left alone and reported, never
 *     stretched to the envelope. Billable days and the line total ARE
 *     recomputed for what moves, through the same projection the push-dates
 *     flow uses (`projectLineMoney`), so one rule prices both.
 *
 * Why not reuse `computePushDatesPreview` wholesale: it treats every line
 * whose own `startDate/endDate` are null as INHERITING the order window,
 * and Make Reservation writes a block's days into `pickupDate/returnDate`
 * only. Pushing a two-block order through it collapses both legs onto the
 * envelope. Per-line windows are the truth here, so this plans per line.
 *
 * Units follow their LINE, not the envelope (the through line, 2026-09-16:
 * `BookingAssignment.orderLineItemId`). Before this, the reschedule route
 * stamped EVERY active assignment with the booking's new window, which
 * smashed a second leg — NECTARHOUSE's cube out 9/18 and again 9/24 — onto
 * one set of days. An unstamped unit still follows its own window by the
 * rule above, which for a single-block reservation is what it always did.
 *
 * Orders that are closed out (RETURNED / LD_CHECK / INVOICED / CLOSED /
 * CANCELLED, archived, or a lost quote) are NEVER re-dated: the money has
 * been said. They come back in `skipped` for the rep to read.
 *
 * Planning is pure (`planWindowFollow`, `npm run test:follow-booking-dates`);
 * the DB half loads, plans, writes and audits.
 */
import { prisma } from '@/lib/prisma'
import { billsAsSpecialtyVehicle, specialtyShape } from '@/lib/pricing/specialtyVehicles'
import { projectLineMoney } from '@/lib/orders/datePushPreview'
import { recalcOrderTotals } from '@/lib/orders'
import { rebaselineCadenceForOrder } from '@/lib/cadence/scheduler'
import { syncOrderWindowSafe } from '@/lib/orders/syncOrderWindow'
import { toCalendarDateString } from '@/lib/dates/calendarDate'
import { ACTIVE_ASSIGNMENT_STATUSES } from '@/lib/scheduling/availability'
import type { DateWindow } from '@/lib/scheduling/assignWindow'

const DAY_MS = 86_400_000
const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime()
const shift = (d: Date, ms: number) => new Date(d.getTime() + ms)

/** An order whose money has been said is never re-dated by a board move. */
const CLOSED_OUT_STATUSES = new Set(['RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED', 'CANCELLED'])

// ── Pure: where one window lands when the reservation moves ───────────

export type WindowFollow =
  | { move: DateWindow; stay?: undefined }
  | { move?: undefined; stay: 'unchanged' | 'interior' | 'would-invert' }

/**
 * Where a window sits after the reservation's own window goes from `from`
 * to `to`. Used for an order's lines, its header, and for a unit that
 * carries no line.
 */
export function planWindowFollow(args: {
  from: DateWindow
  to: DateWindow
  window: DateWindow
}): WindowFollow {
  const { from, to, window } = args
  const startDelta = to.start.getTime() - from.start.getTime()
  const endDelta = to.end.getTime() - from.end.getTime()
  if (startDelta === 0 && endDelta === 0) return { stay: 'unchanged' }

  // A move of the whole reservation: everything on it moves with it, day
  // counts untouched.
  if (startDelta === endDelta) {
    return { move: { start: shift(window.start, startDelta), end: shift(window.end, endDelta) } }
  }

  // A resize: only the edge that moved, and only for what sits on it.
  const start = sameDay(window.start, from.start) ? to.start : window.start
  const end = sameDay(window.end, from.end) ? to.end : window.end
  if (sameDay(start, window.start) && sameDay(end, window.end)) return { stay: 'interior' }
  if (end.getTime() < start.getTime()) return { stay: 'would-invert' }
  return { move: { start, end } }
}

/** Whole days between two windows' starts — for the audit and the message. */
export function moveDeltaDays(from: DateWindow, to: DateWindow): number {
  return Math.round((to.start.getTime() - from.start.getTime()) / DAY_MS)
}

// ── The plan ──────────────────────────────────────────────────────────

export interface PlannedLineMove {
  lineId: string
  from: DateWindow
  to: DateWindow
}

export interface PlannedOrderMove {
  orderId: string
  orderNumber: string
  status: string
  lines: PlannedLineMove[]
  /** Lines left where they are, and why — read back to the rep. */
  held: { lineId: string; description: string; why: 'interior' | 'would-invert' }[]
}

export interface BookingDateFollowPlan {
  from: DateWindow
  to: DateWindow
  /** Units re-stamped with the booking write, in the same transaction. */
  assignmentMoves: { id: string; start: Date; end: Date }[]
  orders: PlannedOrderMove[]
  skipped: { orderNumber: string; why: string }[]
}

const EMPTY_PLAN = (from: DateWindow, to: DateWindow): BookingDateFollowPlan => ({
  from, to, assignmentMoves: [], orders: [], skipped: [],
})

/**
 * Read the booking, its orders and its units, and work out what follows.
 * NO WRITES — the route validates first, then applies this.
 */
export async function planBookingDateFollow(args: {
  bookingId: string
  from: DateWindow
  to: DateWindow
}): Promise<BookingDateFollowPlan> {
  const plan = EMPTY_PLAN(args.from, args.to)

  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      bookingItem: { is: { bookingId: args.bookingId } },
      status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
    },
    select: { id: true, startDate: true, endDate: true, orderId: true, orderLineItemId: true },
  })

  // The orders on this reservation: the ones linked to the booking, plus
  // any named by a unit held on it (a sibling order that took a truck off
  // this booking without carrying the FK).
  const orderIds = new Set<string>(assignments.map((a) => a.orderId).filter((id): id is string => !!id))
  const orders = await prisma.order.findMany({
    where: {
      OR: [{ bookingId: args.bookingId }, { id: { in: [...orderIds] } }],
    },
    select: {
      id: true, orderNumber: true, status: true, quoteStatus: true, archivedAt: true,
      lineItems: {
        select: { id: true, description: true, pickupDate: true, returnDate: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  const lineTargets = new Map<string, DateWindow>()
  for (const o of orders) {
    if (o.archivedAt) { plan.skipped.push({ orderNumber: o.orderNumber, why: 'archived' }); continue }
    if (CLOSED_OUT_STATUSES.has(o.status)) {
      plan.skipped.push({ orderNumber: o.orderNumber, why: `${o.status.toLowerCase().replace(/_/g, ' ')} — dates left alone` })
      continue
    }
    if (o.quoteStatus === 'LOST' || o.quoteStatus === 'EXPIRED') {
      plan.skipped.push({ orderNumber: o.orderNumber, why: 'the quote is closed' })
      continue
    }
    const moved: PlannedLineMove[] = []
    const held: PlannedOrderMove['held'] = []
    for (const li of o.lineItems) {
      const window = { start: li.pickupDate, end: li.returnDate }
      const followed = planWindowFollow({ from: args.from, to: args.to, window })
      if (followed.move) {
        moved.push({ lineId: li.id, from: window, to: followed.move })
        lineTargets.set(li.id, followed.move)
      } else if (followed.stay === 'interior' || followed.stay === 'would-invert') {
        held.push({ lineId: li.id, description: li.description, why: followed.stay })
      }
    }
    if (moved.length === 0 && held.length === 0) continue
    plan.orders.push({ orderId: o.id, orderNumber: o.orderNumber, status: o.status, lines: moved, held })
  }

  // Units: a unit stamped for a line goes exactly where that line goes —
  // that is what the through line is for. Anything else follows its own
  // window by the same rule.
  for (const a of assignments) {
    const viaLine = a.orderLineItemId ? lineTargets.get(a.orderLineItemId) : undefined
    const target =
      viaLine ??
      planWindowFollow({ from: args.from, to: args.to, window: { start: a.startDate, end: a.endDate } }).move
    if (!target) continue
    if (sameDay(target.start, a.startDate) && sameDay(target.end, a.endDate)) continue
    plan.assignmentMoves.push({ id: a.id, start: target.start, end: target.end })
  }

  return plan
}

// ── Apply: the order side of the write ────────────────────────────────

export interface OrderFollowResult {
  orderId: string
  orderNumber: string
  linesMoved: number
  from: { start: string; end: string } | null
  to: { start: string; end: string } | null
  /** Money moved only when the LENGTH changed — a translation is free. */
  totalBefore: number
  totalAfter: number
  held: { description: string; why: string }[]
}

export interface BookingFollowOutcome {
  orders: OrderFollowResult[]
  skipped: { orderNumber: string; why: string }[]
  error: string | null
}

/**
 * Write the order side of a reservation move. NON-FATAL by contract: the
 * booking has already moved when this runs, so a failure here is reported
 * and never thrown — the rep is told the order did not follow rather than
 * being shown a failed reschedule that actually happened.
 */
export async function applyBookingDateFollow(args: {
  plan: BookingDateFollowPlan
  actor?: { userId?: string | null; ipAddress?: string | null }
}): Promise<BookingFollowOutcome> {
  const out: BookingFollowOutcome = { orders: [], skipped: args.plan.skipped, error: null }
  try {
    for (const o of args.plan.orders) {
      const before = await prisma.order.findUnique({
        where: { id: o.orderId },
        select: { id: true, startDate: true, endDate: true, total: true },
      })
      if (!before) continue

      if (o.lines.length > 0) {
        // Every line on the order, because the money projection needs to
        // know what ELSE is on it (a partner-fulfilled unit bills daily).
        const rows = await prisma.orderLineItem.findMany({
          where: { orderId: o.orderId },
          select: {
            id: true, description: true, department: true, type: true, rateType: true,
            rate: true, quantity: true, billableDays: true, lineTotal: true,
            startDate: true, endDate: true, pickupDate: true, returnDate: true,
            parentLineItemId: true, createdAt: true,
            subRentals: { select: { id: true } },
            inventoryItem: { select: { code: true, isSpecialtyVehicle: true } },
          },
        })
        const shapes = rows.map(specialtyShape)
        const byId = new Map(rows.map((r) => [r.id, r]))

        await prisma.$transaction(async (tx) => {
          for (const mv of o.lines) {
            const li = byId.get(mv.lineId)
            if (!li) continue
            const offsetMs = mv.to.start.getTime() - mv.from.start.getTime()
            const money = projectLineMoney({
              department: li.department,
              type: li.type,
              rateType: li.rateType,
              rate: Number(li.rate),
              quantity: li.quantity,
              billableDays: li.billableDays,
              lineTotal: Number(li.lineTotal),
              partnerDaily: billsAsSpecialtyVehicle(specialtyShape(li), shapes),
              pickupDate: mv.to.start,
              returnDate: mv.to.end,
            })
            await tx.orderLineItem.update({
              where: { id: li.id },
              data: {
                // A line that carries its OWN range keeps carrying one —
                // shifted by the same offset, so a custom block stays a
                // custom block.
                startDate: li.startDate ? shift(li.startDate, offsetMs) : null,
                endDate: li.endDate ? shift(li.endDate, offsetMs) : null,
                pickupDate: mv.to.start,
                returnDate: mv.to.end,
                billableDays: money.billableDays,
                lineTotal: money.lineTotal,
              },
            })
          }
        })
      }

      // The header is a MIRROR — re-derived from the lines that just
      // moved, never typed (see lib/orders/syncOrderWindow).
      await syncOrderWindowSafe(o.orderId)
      try { await recalcOrderTotals(o.orderId) } catch (e) { console.error('[followBookingDates] totals:', e) }
      try { await rebaselineCadenceForOrder(o.orderId) } catch (e) { console.error('[followBookingDates] cadence:', e) }

      const after = await prisma.order.findUnique({
        where: { id: o.orderId },
        select: { startDate: true, endDate: true, total: true },
      })
      try {
        await prisma.auditLog.create({
          data: {
            userId: args.actor?.userId ?? null,
            ipAddress: args.actor?.ipAddress ?? null,
            action: 'order.dates_followed_reservation',
            entityType: 'order',
            entityId: o.orderId,
            oldValues: {
              startDate: before.startDate ? toCalendarDateString(before.startDate) : null,
              endDate: before.endDate ? toCalendarDateString(before.endDate) : null,
              total: Number(before.total ?? 0),
            },
            newValues: {
              startDate: after?.startDate ? toCalendarDateString(after.startDate) : null,
              endDate: after?.endDate ? toCalendarDateString(after.endDate) : null,
              total: Number(after?.total ?? 0),
              reservationFrom: { start: toCalendarDateString(args.plan.from.start), end: toCalendarDateString(args.plan.from.end) },
              reservationTo: { start: toCalendarDateString(args.plan.to.start), end: toCalendarDateString(args.plan.to.end) },
              lineIds: o.lines.map((l) => l.lineId),
              heldLineIds: o.held.map((h) => h.lineId),
            },
          },
        })
      } catch (e) {
        console.error('[followBookingDates] audit failed:', e)
      }

      out.orders.push({
        orderId: o.orderId,
        orderNumber: o.orderNumber,
        linesMoved: o.lines.length,
        from: before.startDate && before.endDate
          ? { start: toCalendarDateString(before.startDate), end: toCalendarDateString(before.endDate) }
          : null,
        to: after?.startDate && after?.endDate
          ? { start: toCalendarDateString(after.startDate), end: toCalendarDateString(after.endDate) }
          : null,
        totalBefore: Number(before.total ?? 0),
        totalAfter: Number(after?.total ?? 0),
        held: o.held.map((h) => ({
          description: h.description,
          why: h.why === 'interior'
            ? 'its own days are inside the reservation — left where it was'
            : 'the new window would end before it starts — left where it was',
        })),
      })
    }
    return out
  } catch (e) {
    console.error('[followBookingDates] failed:', e)
    return { ...out, error: e instanceof Error ? e.message : 'the order did not follow' }
  }
}
