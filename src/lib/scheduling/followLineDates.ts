/**
 * The reservation FOLLOWS the order's dates.
 *
 * Wes, 2026-09-17, on Someday Studios' passenger van: "I changed it in the
 * order, but that did not change it on the reservation as we had planned
 * for it to do." The order said the 17th; the board still drew the van on
 * the 18th.
 *
 * Why. An order's dates live on its LINES (`pickupDate` / `returnDate`;
 * the header is a mirror). A reservation is three things: the Booking
 * ENVELOPE (`Booking.startDate/endDate`), the class HOLD (`BookingItem`,
 * dateless — it rides the envelope) and the UNIT (`BookingAssignment`,
 * whose `startDate/endDate` are COPIES stamped at assign time from the
 * quoted block, see assignWindow.ts). Two edits move line dates — the
 * row editor (`PUT /line-items/[lineId]`) and "Change dates…"
 * (`POST /dates/apply`) — and before this module:
 *
 *   · the row editor re-ran `holdOnQuoteSend`, which WIDENS the envelope,
 *     but only when the line's own `assetCategoryId` was set — null on
 *     every catalog-bound line, so for a real van it never fired;
 *   · "Change dates…" read the assignments to warn about conflicts and
 *     then wrote nothing on the booking side at all;
 *   · nothing anywhere re-stamped an ASSIGNMENT. The unit stayed on its
 *     old days, which is exactly what the gantt draws — and because
 *     `coverageOfBlock` matches by exact day, the NEW block read as
 *     unfilled while the same van sat held on the old one.
 *
 * `syncReservationToLineDates` is the one entry both routes call. Pure
 * planning in `planAssignmentFollow` / `bookingEnvelopeFor`
 * (`npm run test:follow-line-dates`); the DB half loads, plans, checks
 * each moving unit for a hard overlap on its new days, writes, audits.
 *
 * Deliberate limits:
 *   · A unit that is CHECKED_OUT has already left. Its pickup cannot
 *     move; its return follows when only the return moved.
 *   · A unit already booked elsewhere on the new days is NOT moved and is
 *     named back to the caller (the row editor alerts; "Change dates…"
 *     had the rep acknowledge those conflicts up front, so it passes
 *     `allowConflicts`). A hard block on the line edit would be worse: the
 *     client's dates are the client's dates, and the truck is dispatch's
 *     problem to re-pick.
 *   · The envelope SHRINKS only when nothing else holds the old days: a
 *     class held on the booking with no quoted line behind it (a bare
 *     hold from Make Reservation) keeps the envelope widen-only, because
 *     the envelope is the only date that hold has.
 */
import { prisma } from '@/lib/prisma'
import { holdOnQuoteSend, holdCategoryForLine } from '@/lib/orders/holdOnQuoteSend'
import { computeUnitStates, ACTIVE_ASSIGNMENT_STATUSES, LIVE_ITEM_STATUSES } from '@/lib/scheduling/availability'
import { quotedBlocks, type DateWindow } from '@/lib/scheduling/assignWindow'
import { formatCalendarRange, toCalendarDateString } from '@/lib/dates/calendarDate'

const sameDay = (a: Date, b: Date): boolean => a.getTime() === b.getTime()
const sameWindow = (a: DateWindow, b: DateWindow): boolean => sameDay(a.start, b.start) && sameDay(a.end, b.end)
const overlaps = (a: DateWindow, b: DateWindow): boolean => a.start <= b.end && a.end >= b.start

// ── Pure: which units follow a moved block ────────────────────────────

export interface FollowCandidate {
  id: string
  assetId: string
  /** ASSIGNED | CHECKED_OUT — anything else holds nothing. */
  status: string
  startDate: Date
  endDate: Date
  /** The order this unit was stamped for, when known. */
  orderId: string | null
}

export interface PlannedMove {
  id: string
  assetId: string
  startDate: Date
  endDate: Date
}

export interface FollowPlan {
  moves: PlannedMove[]
  /** Units on the old block that stay, and why. */
  stays: { id: string; assetId: string; why: 'checked-out' | 'other-order' | 'beyond-quantity' }[]
}

/**
 * The units that should move with ONE quoted block going from `from` to
 * `to`.
 *
 * A unit belongs to the block whose days it carries verbatim (the rule
 * `coverageOfBlock` counts by), so the exact matches are the candidates.
 * When nothing matches exactly and the class has no OTHER block on this
 * order, the unit was stamped before blocks existed (an order span, a
 * gantt drag) and overlap is the only reading left — so overlap is
 * accepted there, and only there: with a second block on the order an
 * overlapping unit may well be that block's.
 *
 * Up to `quantity` move — the moved line's own count — so a second line
 * still quoting the old days keeps its units. This order's own units go
 * first, then unstamped ones; a unit stamped for a sibling order never
 * moves for this one.
 */
export function planAssignmentFollow(args: {
  from: DateWindow
  to: DateWindow
  quantity: number
  orderId: string | null
  assignments: FollowCandidate[]
  /** Every block still quoted against this class on the order AFTER the
   *  edit, other than `to` itself. Non-empty disables the overlap fallback. */
  otherBlocks: DateWindow[]
}): FollowPlan {
  const plan: FollowPlan = { moves: [], stays: [] }
  if (sameWindow(args.from, args.to)) return plan

  const live = args.assignments.filter((a) => a.status === 'ASSIGNED' || a.status === 'CHECKED_OUT')
  const exact = live.filter((a) => sameWindow({ start: a.startDate, end: a.endDate }, args.from))
  const pool =
    exact.length > 0 || args.otherBlocks.length > 0
      ? exact
      : live.filter((a) => overlaps({ start: a.startDate, end: a.endDate }, args.from))

  // With no order named (a bare hold's line-less booking) every unit on
  // the block is fair game; with one, a sibling order's unit is not.
  const own = pool.filter((a) => args.orderId != null && a.orderId === args.orderId)
  const unstamped = pool.filter((a) => a.orderId == null)
  const foreign = args.orderId == null ? [] : pool.filter((a) => a.orderId != null && a.orderId !== args.orderId)
  for (const a of foreign) plan.stays.push({ id: a.id, assetId: a.assetId, why: 'other-order' })

  const ordered = args.orderId == null ? pool : [...own, ...unstamped]
  const quota = Math.max(0, Math.floor(args.quantity))
  const pickupMoved = !sameDay(args.from.start, args.to.start)
  let taken = 0
  for (const a of ordered) {
    if (taken >= quota) {
      plan.stays.push({ id: a.id, assetId: a.assetId, why: 'beyond-quantity' })
      continue
    }
    if (a.status === 'CHECKED_OUT') {
      // Already out the gate: the pickup happened. Only the return can
      // follow, and only when the pickup did not move.
      if (pickupMoved) {
        plan.stays.push({ id: a.id, assetId: a.assetId, why: 'checked-out' })
        continue
      }
      plan.moves.push({ id: a.id, assetId: a.assetId, startDate: a.startDate, endDate: args.to.end })
      taken++
      continue
    }
    plan.moves.push({ id: a.id, assetId: a.assetId, startDate: args.to.start, endDate: args.to.end })
    taken++
  }
  return plan
}

// ── Pure: the envelope a booking should carry ─────────────────────────

/**
 * Where the booking's window should sit once its lines and units have
 * moved: the union of every quoted hold line on its live orders and every
 * live assignment. With a bare hold on the booking (a class held with no
 * quoted line behind it) the envelope may only WIDEN — the envelope is the
 * only date that hold has. Returns null when nothing dated remains or
 * nothing changes.
 */
export function bookingEnvelopeFor(args: {
  current: DateWindow
  lineWindows: DateWindow[]
  assignmentWindows: DateWindow[]
  bareHold: boolean
}): DateWindow | null {
  const all = [...args.lineWindows, ...args.assignmentWindows]
  if (all.length === 0) return null
  let start = all[0].start
  let end = all[0].end
  for (const w of all) {
    if (w.start < start) start = w.start
    if (w.end > end) end = w.end
  }
  if (args.bareHold) {
    if (args.current.start < start) start = args.current.start
    if (args.current.end > end) end = args.current.end
  }
  const next = { start, end }
  return sameWindow(next, args.current) ? null : next
}

// ── DB: one entry for both routes ─────────────────────────────────────

export interface LineDateChange {
  lineId: string
  from: DateWindow
  to: DateWindow
}

export interface FollowOutcome {
  /** Units re-stamped onto their new days. */
  moved: { assignmentId: string; unitName: string; start: string; end: string }[]
  /** Units that could not follow, with a reason the rep can act on. */
  blocked: { assignmentId: string; unitName: string; reason: string }[]
  /** Units that followed but now sit inside another booking's turnaround. */
  tight: { assignmentId: string; unitName: string; reason: string }[]
  envelope: { start: string; end: string } | null
  error: string | null
}

const EMPTY: FollowOutcome = { moved: [], blocked: [], tight: [], envelope: null, error: null }

/**
 * Move the reservation with the order's lines. NON-FATAL by contract —
 * the line edit has already landed; a failure here is reported, never
 * thrown, so the order can never be left disagreeing with itself because
 * the board could not be told.
 */
export async function syncReservationToLineDates(args: {
  orderId: string
  changes: LineDateChange[]
  /** The rep already acknowledged the conflicts (the "Change dates…"
   *  modal's tick) — move even onto a unit's booked days. */
  allowConflicts?: boolean
  actor?: { userId?: string | null; ipAddress?: string | null }
  bufferDays?: number
}): Promise<FollowOutcome> {
  const out: FollowOutcome = { moved: [], blocked: [], tight: [], envelope: null, error: null }
  try {
    const moved = args.changes.filter((c) => !sameWindow(c.from, c.to))
    if (moved.length === 0) return out

    const order = await prisma.order.findUnique({
      where: { id: args.orderId },
      select: { id: true, jobId: true, bookingId: true },
    })
    if (!order) return { ...out, error: 'order not found' }

    // Which of the moved lines hold anything, and against which class.
    const lines = await prisma.orderLineItem.findMany({
      where: { id: { in: moved.map((c) => c.lineId) } },
      select: {
        id: true, quantity: true, department: true, assetCategoryId: true,
        assetCategory: { select: { department: true } },
        inventoryItem: { select: { department: true, trackingMode: true, legacyAssetCategoryId: true } },
      },
    })
    const heldChanges = moved
      .map((c) => {
        const li = lines.find((l) => l.id === c.lineId)
        const categoryId = li ? holdCategoryForLine(li) : null
        return li && categoryId ? { ...c, categoryId, quantity: li.quantity } : null
      })
      .filter((c): c is LineDateChange & { categoryId: string; quantity: number } => c !== null)
    if (heldChanges.length === 0) return out

    // The booking this order holds on. holdOnQuoteSend links the order to
    // the job's AGENT_DIRECT booking when it finds one unlinked, and widens
    // the envelope over the new days, so it runs first; the tighten below
    // is the half it does not do.
    const raised = await holdOnQuoteSend(order.id)
    if (raised.error) console.error('[followLineDates] hold recompute failed:', raised.error)
    const bookingId =
      order.bookingId ??
      (await prisma.order.findUnique({ where: { id: order.id }, select: { bookingId: true } }))?.bookingId ??
      null
    if (!bookingId) return out

    // One move per (class, from → to); two lines on the same block moving
    // the same way are one decision of the summed quantity.
    const grouped = new Map<string, LineDateChange & { categoryId: string; quantity: number }>()
    for (const c of heldChanges) {
      const key = `${c.categoryId}|${toCalendarDateString(c.from.start)}|${toCalendarDateString(c.from.end)}|${toCalendarDateString(c.to.start)}|${toCalendarDateString(c.to.end)}`
      const g = grouped.get(key)
      if (g) g.quantity += c.quantity
      else grouped.set(key, { ...c })
    }

    const bufferDays = Number.isFinite(args.bufferDays) ? (args.bufferDays as number) : 1
    const movedIds = new Set<string>()
    for (const change of grouped.values()) {
      const items = await prisma.bookingItem.findMany({
        where: { bookingId, categoryId: change.categoryId, status: { in: [...LIVE_ITEM_STATUSES] } },
        select: {
          id: true,
          assignments: {
            where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
            select: {
              id: true, assetId: true, status: true, startDate: true, endDate: true, orderId: true,
              asset: { select: { id: true, unitName: true, tier: true } },
            },
          },
        },
      })
      const candidates = items.flatMap((it) => it.assignments).filter((a) => !movedIds.has(a.id))
      if (candidates.length === 0) continue

      // Every block still quoted against this class on THIS order, other
      // than the one the line now sits on.
      const classLines = await prisma.orderLineItem.findMany({
        where: {
          orderId: order.id,
          OR: [{ assetCategoryId: change.categoryId }, { inventoryItem: { legacyAssetCategoryId: change.categoryId } }],
        },
        select: { pickupDate: true, returnDate: true, quantity: true },
      })
      const otherBlocks = quotedBlocks(classLines).filter((b) => !sameWindow(b, change.to))

      const plan = planAssignmentFollow({
        from: change.from,
        to: change.to,
        quantity: change.quantity,
        orderId: order.id,
        assignments: candidates,
        otherBlocks,
      })
      if (plan.moves.length === 0) continue

      const ownIds = new Set(candidates.map((a) => a.id))
      for (const mv of plan.moves) {
        const a = candidates.find((c) => c.id === mv.id)!
        // The unit on its NEW days, against everything that is not this
        // booking — the same state the picker would show for that pick.
        const lookaround = Math.max(1, bufferDays + 1)
        const others = await prisma.bookingAssignment.findMany({
          where: {
            assetId: a.assetId,
            status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
            startDate: { lte: new Date(mv.endDate.getTime() + lookaround * 86_400_000) },
            endDate: { gte: new Date(mv.startDate.getTime() - lookaround * 86_400_000) },
            id: { notIn: [...ownIds] },
            bookingItem: { is: { bookingId: { not: bookingId } } },
          },
          select: { assetId: true, startDate: true, endDate: true, bookingItem: { select: { booking: { select: { jobName: true } } } } },
        })
        const state = computeUnitStates(
          [{ id: a.asset.id, unitName: a.asset.unitName, tier: a.asset.tier }],
          others.map((o) => ({ assetId: o.assetId, startDate: o.startDate, endDate: o.endDate, jobName: o.bookingItem.booking?.jobName ?? null })),
          mv.startDate,
          mv.endDate,
          bufferDays,
        )[0]
        const who = state?.conflict
          ? `${state.conflict.jobName ? `${state.conflict.jobName}, ` : ''}${formatCalendarRange(state.conflict.start, state.conflict.end)}`
          : ''
        if (state?.state === 'booked' && !args.allowConflicts) {
          out.blocked.push({
            assignmentId: a.id,
            unitName: a.asset.unitName,
            reason: `${a.asset.unitName} is already booked ${formatCalendarRange(mv.startDate, mv.endDate)}${who ? ` (${who})` : ''} — it stays on ${formatCalendarRange(a.startDate, a.endDate)}; pick another unit for the new days`,
          })
          continue
        }
        await prisma.$transaction([
          prisma.bookingAssignment.update({
            where: { id: a.id },
            data: { startDate: mv.startDate, endDate: mv.endDate },
          }),
          prisma.auditLog.create({
            data: {
              userId: args.actor?.userId ?? null,
              ipAddress: args.actor?.ipAddress ?? null,
              action: 'booking_assignment.dates_followed_line',
              entityType: 'BookingAssignment',
              entityId: a.id,
              oldValues: { startDate: toCalendarDateString(a.startDate), endDate: toCalendarDateString(a.endDate) },
              newValues: {
                startDate: toCalendarDateString(mv.startDate),
                endDate: toCalendarDateString(mv.endDate),
                orderId: order.id,
                categoryId: change.categoryId,
                lineIds: heldChanges.filter((c) => c.categoryId === change.categoryId).map((c) => c.lineId),
                overrodeConflict: state?.state === 'booked',
              },
            },
          }),
        ])
        movedIds.add(a.id)
        out.moved.push({
          assignmentId: a.id,
          unitName: a.asset.unitName,
          start: toCalendarDateString(mv.startDate),
          end: toCalendarDateString(mv.endDate),
        })
        if (state?.state === 'buffer' || (state?.state === 'booked' && args.allowConflicts)) {
          out.tight.push({
            assignmentId: a.id,
            unitName: a.asset.unitName,
            reason: state.state === 'booked'
              ? `${a.asset.unitName} is now double-booked ${who}`
              : `${a.asset.unitName} has no clear day beside ${who}`,
          })
        }
      }
    }

    // The envelope, both directions. holdOnQuoteSend widened it above;
    // this brings it in when nothing on the booking still needs the old
    // days.
    const envelope = await tightenBookingEnvelope(bookingId)
    if (envelope) out.envelope = { start: toCalendarDateString(envelope.start), end: toCalendarDateString(envelope.end) }
    return out
  } catch (e) {
    console.error('[followLineDates] failed:', e)
    return { ...EMPTY, moved: out.moved, blocked: out.blocked, tight: out.tight, error: e instanceof Error ? e.message : 'follow failed' }
  }
}

/**
 * Re-fit `Booking.startDate/endDate` to what the booking actually holds:
 * every quoted hold line on its live orders plus every live assignment.
 * Widen-only while a bare hold (a class with no quoted line) sits on it.
 * Returns the window written, or null when nothing changed.
 */
export async function tightenBookingEnvelope(bookingId: string): Promise<DateWindow | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      jobId: true,
      startDate: true,
      endDate: true,
      items: {
        where: { status: { in: [...LIVE_ITEM_STATUSES] } },
        select: {
          categoryId: true,
          assignments: {
            where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
            select: { startDate: true, endDate: true },
          },
        },
      },
    },
  })
  if (!booking) return null

  // The same sibling rule holdOnQuoteSend uses for the peak: live orders
  // that hold on this booking, or on the job with no booking of their own.
  const orders = await prisma.order.findMany({
    where: {
      status: { not: 'CANCELLED' },
      quoteStatus: { notIn: ['LOST', 'EXPIRED'] },
      archivedAt: null,
      OR: [{ bookingId: booking.id }, ...(booking.jobId ? [{ jobId: booking.jobId, bookingId: null }] : [])],
    },
    select: {
      lineItems: {
        select: {
          pickupDate: true, returnDate: true, department: true, assetCategoryId: true,
          assetCategory: { select: { department: true } },
          inventoryItem: { select: { department: true, trackingMode: true, legacyAssetCategoryId: true } },
        },
      },
    },
  })
  const heldLines = orders
    .flatMap((o) => o.lineItems)
    .map((li) => ({ categoryId: holdCategoryForLine(li), pickupDate: li.pickupDate, returnDate: li.returnDate }))
    .filter((l): l is { categoryId: string; pickupDate: Date; returnDate: Date } => !!l.categoryId && !!l.pickupDate && !!l.returnDate)
  const quotedCategories = new Set(heldLines.map((l) => l.categoryId))
  const bareHold = booking.items.some((it) => !quotedCategories.has(it.categoryId))

  const next = bookingEnvelopeFor({
    current: { start: booking.startDate, end: booking.endDate },
    lineWindows: heldLines.map((l) => ({ start: l.pickupDate, end: l.returnDate })),
    assignmentWindows: booking.items.flatMap((it) => it.assignments.map((a) => ({ start: a.startDate, end: a.endDate }))),
    bareHold,
  })
  if (!next) return null
  await prisma.booking.update({ where: { id: booking.id }, data: { startDate: next.start, endDate: next.end } })
  return next
}
