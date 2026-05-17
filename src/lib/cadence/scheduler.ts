import { prisma } from '@/lib/prisma'
import type { CadenceEventType, CadenceState, Prisma, PrismaClient } from '@prisma/client'

/**
 * Cadence event scheduler — the write side of the CRH cadence engine.
 *
 * Public API:
 *   - transitionCadenceState(orderId, newState): atomic state change + reschedule
 *   - rebaselineCadenceForOrder(orderId): drop + recreate future events for the
 *     current state (call this when Order.startDate/endDate changes)
 *   - clearUnexecutedFutureEvents(orderId): used internally and by tests
 *
 * Per the CRH brief §13:
 *   - "When pickup date changes, DELETE all unexecuted future CadenceEvents
 *     and REGENERATE." → rebaselineCadenceForOrder()
 *   - Idempotent: re-running a transition into the same state shouldn't
 *     duplicate scheduled events. We achieve this by clearing all future
 *     unexecuted events for the order before scheduling.
 *
 * Event timing offsets live in EVENT_PLAN below, keyed by CadenceState. Each
 * entry specifies the offset relative to either `now` (when the transition
 * fires) or `pickup` (Order.startDate). If the computed `scheduledFor` lands
 * in the past, we skip the event — the runner won't fire events whose moment
 * has already passed.
 */

type Anchor = 'now' | 'pickup' | 'return'

interface EventTemplate {
  eventType: CadenceEventType
  anchor: Anchor
  /** Offset in milliseconds. Negative offsets fire BEFORE the anchor; positive AFTER. */
  offsetMs: number
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

const EVENT_PLAN: Partial<Record<CadenceState, EventTemplate[]>> = {
  QUOTE_SENT: [
    { eventType: 'QUOTE_NUDGE_24H', anchor: 'now', offsetMs: 24 * HOUR },
    { eventType: 'QUOTE_CHECKIN_T72', anchor: 'pickup', offsetMs: -72 * HOUR },
    { eventType: 'QUOTE_CLOSEDOWN_T24', anchor: 'pickup', offsetMs: -24 * HOUR },
    { eventType: 'QUOTE_LOST_MARK', anchor: 'pickup', offsetMs: 0 },
  ],
  QUOTE_ACKNOWLEDGED: [
    { eventType: 'ACK_QUESTIONS_PROMPT_24H', anchor: 'now', offsetMs: 24 * HOUR },
    { eventType: 'ACK_SWEETEN_T72', anchor: 'pickup', offsetMs: -72 * HOUR },
    { eventType: 'ACK_CLOSEDOWN_T24', anchor: 'pickup', offsetMs: -24 * HOUR },
  ],
  BOOKED: [
    { eventType: 'BOOKING_WELCOME', anchor: 'now', offsetMs: 0 },
    { eventType: 'PRE_PICKUP_DETAILS_T48', anchor: 'pickup', offsetMs: -48 * HOUR },
    { eventType: 'FINAL_CONFIRM_T24', anchor: 'pickup', offsetMs: -24 * HOUR },
    // PICKUP_DAY_AM fires at 8 AM (job tz); we'll schedule for pickup-anchored
    // 00:00 in UTC and let the runner adjust for now. Future refinement:
    // store a true tz-aware "morning of" timestamp once the per-order timezone
    // field lands.
    { eventType: 'PICKUP_DAY_AM', anchor: 'pickup', offsetMs: 8 * HOUR },
    { eventType: 'RETURN_REMINDER_T24', anchor: 'return', offsetMs: -24 * HOUR },
  ],
  LOST: [
    { eventType: 'LOST_REENGAGEMENT_2W', anchor: 'now', offsetMs: 14 * DAY },
  ],
}

interface OrderTimingForCadence {
  id: string
  startDate: Date | null
  endDate: Date | null
  lostReason?: import('@prisma/client').LostReason | null
}

function computeScheduledFor(
  template: EventTemplate,
  order: OrderTimingForCadence,
  now: Date,
): Date | null {
  if (template.anchor === 'now') {
    return new Date(now.getTime() + template.offsetMs)
  }
  if (template.anchor === 'pickup') {
    if (!order.startDate) return null
    return new Date(order.startDate.getTime() + template.offsetMs)
  }
  if (template.anchor === 'return') {
    if (!order.endDate) return null
    return new Date(order.endDate.getTime() + template.offsetMs)
  }
  return null
}

/**
 * Returns false when the template should be skipped for this order. Today the
 * only built-in skip rule is "no LOST_REENGAGEMENT_2W if lostReason is
 * EXPLICIT_REJECTION" — per CRH brief §8.
 */
function shouldScheduleTemplate(
  template: EventTemplate,
  order: OrderTimingForCadence,
): boolean {
  if (template.eventType === 'LOST_REENGAGEMENT_2W' && order.lostReason === 'EXPLICIT_REJECTION') {
    return false
  }
  return true
}

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

/**
 * Remove all unexecuted, non-skipped CadenceEvents whose scheduledFor is in
 * the future. Past-due unfired events also get cleared so a re-baseline never
 * resurrects something the runner missed.
 */
export async function clearUnexecutedFutureEvents(
  orderId: string,
  tx: Tx | PrismaClient = prisma,
): Promise<number> {
  const res = await (tx as Prisma.TransactionClient | typeof prisma).cadenceEvent.deleteMany({
    where: {
      orderId,
      executedAt: null,
      skipped: false,
    },
  })
  return res.count
}

/**
 * Schedule the event plan for `state`. Returns the events created. Does not
 * touch Order.cadenceState — call this from transitionCadenceState() or use
 * it standalone when you already updated the state elsewhere.
 */
export async function scheduleCadenceForState(
  orderId: string,
  state: CadenceState,
  opts: { now?: Date } = {},
  tx: Tx | PrismaClient = prisma,
): Promise<{ scheduled: number; skippedPast: number }> {
  const templates = EVENT_PLAN[state] || []
  if (templates.length === 0) return { scheduled: 0, skippedPast: 0 }

  const order = await (tx as Prisma.TransactionClient | typeof prisma).order.findUnique({
    where: { id: orderId },
    select: { id: true, startDate: true, endDate: true, lostReason: true },
  })
  if (!order) return { scheduled: 0, skippedPast: 0 }

  const now = opts.now ?? new Date()
  const toCreate: { orderId: string; eventType: CadenceEventType; scheduledFor: Date }[] = []
  let skippedPast = 0
  for (const t of templates) {
    if (!shouldScheduleTemplate(t, order)) continue
    const when = computeScheduledFor(t, order, now)
    if (!when) continue
    if (when.getTime() < now.getTime() - HOUR) {
      // More than an hour in the past — don't schedule. (A small grace window
      // catches "scheduled for 30 minutes ago" cases where a transition fires
      // just after a threshold.)
      skippedPast++
      continue
    }
    toCreate.push({ orderId, eventType: t.eventType, scheduledFor: when })
  }
  if (toCreate.length === 0) return { scheduled: 0, skippedPast }

  await (tx as Prisma.TransactionClient | typeof prisma).cadenceEvent.createMany({
    data: toCreate,
  })
  return { scheduled: toCreate.length, skippedPast }
}

/**
 * Atomic state change: clear unexecuted future events, update Order.cadenceState,
 * schedule the new state's event plan. Use this from state-transition callsites
 * (quote-sent endpoint, AI reply classifier, booking signed handler, etc).
 */
export async function transitionCadenceState(
  orderId: string,
  newState: CadenceState,
  opts: { now?: Date } = {},
): Promise<{ scheduled: number; cleared: number; skippedPast: number }> {
  return prisma.$transaction(async (tx) => {
    const cleared = await clearUnexecutedFutureEvents(orderId, tx as unknown as Tx)
    await tx.order.update({ where: { id: orderId }, data: { cadenceState: newState } })
    const sch = await scheduleCadenceForState(orderId, newState, opts, tx as unknown as Tx)
    return { scheduled: sch.scheduled, cleared, skippedPast: sch.skippedPast }
  })
}

/**
 * Re-baseline cadence after the Order's pickup date moved. Clears all unfired
 * future events and re-schedules the current state's plan against the new
 * dates. Per CRH brief §13: "Whenever an Order's pickupDate is updated, the
 * system must DELETE all unexecuted future CadenceEvents and REGENERATE."
 */
export async function rebaselineCadenceForOrder(
  orderId: string,
  opts: { now?: Date } = {},
): Promise<{ scheduled: number; cleared: number; skippedPast: number; state: CadenceState | null }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { cadenceState: true } })
    if (!order) return { scheduled: 0, cleared: 0, skippedPast: 0, state: null }
    const cleared = await clearUnexecutedFutureEvents(orderId, tx as unknown as Tx)
    const sch = await scheduleCadenceForState(orderId, order.cadenceState, opts, tx as unknown as Tx)
    return { scheduled: sch.scheduled, cleared, skippedPast: sch.skippedPast, state: order.cadenceState }
  })
}
