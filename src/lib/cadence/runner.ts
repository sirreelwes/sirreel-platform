import { prisma } from '@/lib/prisma'
import type { CadenceEvent, CadenceEventType } from '@prisma/client'
import { sendCadenceEmail } from '@/lib/email/sendCadenceEmail'
import { loadCadenceContextForOrder, buildTemplateContext } from '@/lib/cadence/context'
import { transitionCadenceState } from '@/lib/cadence/scheduler'

/**
 * Cadence event runner — fired by /api/cron/cadence every 15 minutes. Pulls
 * due events (scheduledFor <= now AND executedAt IS NULL AND skipped = false),
 * routes each to its handler, and persists the outcome.
 *
 * Safety gates (CRH brief §13):
 *   1. Order.status === 'CANCELLED' → skip with reason
 *   2. Order.cadenceManualOverride === true → skip with reason
 *   3. Order.cadencePausedUntil > now → skip (event stays open and re-evaluates)
 *
 * Today the handlers are STUBS — they mark events executed without sending
 * email. Phase 1.3 wires the template engine + Resend send into each handler.
 * Keeping the runner shippable now lets the cron run idempotently against
 * synthetic test data and exercise the scheduling logic.
 */

export interface RunSummary {
  total: number
  executed: number
  skipped: number
  failed: number
  events: { id: string; eventType: CadenceEventType; outcome: 'executed' | 'skipped' | 'failed'; reason?: string }[]
}

interface EventWithOrder extends CadenceEvent {
  order: {
    id: string
    status: string
    cadenceManualOverride: boolean
    cadencePausedUntil: Date | null
  } | null
}

const HANDLER_LABEL = '[cadence-runner]'

export async function runDueCadenceEvents(opts: { now?: Date; batchSize?: number } = {}): Promise<RunSummary> {
  const now = opts.now ?? new Date()
  const batchSize = opts.batchSize ?? 100

  const due = (await prisma.cadenceEvent.findMany({
    where: {
      executedAt: null,
      skipped: false,
      scheduledFor: { lte: now },
    },
    orderBy: { scheduledFor: 'asc' },
    take: batchSize,
    include: {
      order: {
        select: {
          id: true,
          status: true,
          cadenceManualOverride: true,
          cadencePausedUntil: true,
        },
      },
    },
  })) as EventWithOrder[]

  const summary: RunSummary = {
    total: due.length,
    executed: 0,
    skipped: 0,
    failed: 0,
    events: [],
  }

  for (const event of due) {
    const outcome = await processOne(event, now)
    summary.events.push({ id: event.id, eventType: event.eventType, ...outcome })
    if (outcome.outcome === 'executed') summary.executed++
    else if (outcome.outcome === 'skipped') summary.skipped++
    else summary.failed++
  }

  return summary
}

async function processOne(
  event: EventWithOrder,
  now: Date,
): Promise<{ outcome: 'executed' | 'skipped' | 'failed'; reason?: string }> {
  const safety = checkSafetyGates(event, now)
  if (safety) {
    await markSkipped(event.id, safety)
    return { outcome: 'skipped', reason: safety }
  }

  try {
    const result = await dispatch(event)
    if (result.skipped) {
      await markSkipped(event.id, result.reason || 'handler-skipped')
      return { outcome: 'skipped', reason: result.reason }
    }
    await prisma.cadenceEvent.update({
      where: { id: event.id },
      data: { executedAt: now, emailId: result.emailId ?? null },
    })
    return { outcome: 'executed' }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(HANDLER_LABEL, 'event handler threw:', event.id, event.eventType, reason)
    return { outcome: 'failed', reason }
  }
}

function checkSafetyGates(event: EventWithOrder, now: Date): string | null {
  if (!event.order) return 'order-not-found'
  if (event.order.status === 'CANCELLED') return 'order-cancelled'
  if (event.order.cadenceManualOverride) return 'manual-override'
  if (event.order.cadencePausedUntil && event.order.cadencePausedUntil.getTime() > now.getTime()) {
    return `paused-until-${event.order.cadencePausedUntil.toISOString()}`
  }
  return null
}

async function markSkipped(id: string, reason: string): Promise<void> {
  await prisma.cadenceEvent.update({
    where: { id },
    data: { skipped: true, skipReason: reason, executedAt: new Date() },
  })
}

interface HandlerResult {
  skipped?: boolean
  reason?: string
  emailId?: string | null
}

/**
 * Per-event dispatch. Phase 2.2 wires the four QUOTE_* events to real email
 * sends and the QUOTE_LOST_MARK state transition; the rest remain stubs and
 * will be filled in by later phases (booked cadence, re-engagement, etc.).
 */
async function dispatch(event: EventWithOrder): Promise<HandlerResult> {
  switch (event.eventType) {
    case 'QUOTE_NUDGE_24H':
      return handleStateGatedEmail(event, 'QUOTE_NUDGE_24H', {
        requiredStates: ['QUOTE_SENT'],
        requirePickupHoursAhead: 48,
      })
    case 'QUOTE_CHECKIN_T72':
      return handleStateGatedEmail(event, 'QUOTE_CHECKIN_T72', { requiredStates: ['QUOTE_SENT'] })
    case 'QUOTE_CLOSEDOWN_T24':
      return handleStateGatedEmail(event, 'QUOTE_CLOSEDOWN_T24', { requiredStates: ['QUOTE_SENT'] })
    case 'QUOTE_LOST_MARK':
      return handleQuoteLostMark(event)
    case 'ACK_QUESTIONS_PROMPT_24H':
      return handleStateGatedEmail(event, 'ACK_QUESTIONS_PROMPT_24H', {
        requiredStates: ['QUOTE_ACKNOWLEDGED'],
        requirePickupHoursAhead: 48,
      })
    case 'ACK_SWEETEN_T72':
      return handleStateGatedEmail(event, 'ACK_SWEETEN_T72', { requiredStates: ['QUOTE_ACKNOWLEDGED'] })
    case 'ACK_CLOSEDOWN_T24':
      return handleStateGatedEmail(event, 'ACK_CLOSEDOWN_T24', { requiredStates: ['QUOTE_ACKNOWLEDGED'] })

    // ── Booked cadence (Phase 4.1) ──────────────────────────────────────
    // Each handler accepts any state in the booked-through-returned arc so
    // a slipped clock (event fired late, state already advanced) still
    // sends instead of getting marked skipped.
    case 'BOOKING_WELCOME':
      return handleStateGatedEmail(event, 'BOOKING_WELCOME', {
        requiredStates: ['BOOKED', 'PICKUP_CONFIRMED', 'IN_PROGRESS'],
      })
    // Phase 3 lifecycle — emitted by the LOADED_READY rollup. The
    // OrderStatus is LOADED_READY by then but CadenceState has no
    // LOADED_READY peer (see Phase 1 projection table), so cadence
    // sits at BOOKED through this event. Allow PICKUP_CONFIRMED and
    // IN_PROGRESS too for slipped-clock cases (event fires late and
    // cadence has already advanced).
    case 'LOADED_AND_READY':
      return handleStateGatedEmail(event, 'LOADED_AND_READY', {
        requiredStates: ['BOOKED', 'PICKUP_CONFIRMED', 'IN_PROGRESS'],
      })
    case 'COI_RECEIVED_ACK':
      return handleStateGatedEmail(event, 'COI_RECEIVED_ACK', {
        requiredStates: ['BOOKED', 'PICKUP_CONFIRMED', 'IN_PROGRESS', 'RETURNED'],
      })
    case 'PRE_PICKUP_DETAILS_T48':
      return handleStateGatedEmail(event, 'PRE_PICKUP_DETAILS_T48', {
        requiredStates: ['BOOKED', 'PICKUP_CONFIRMED'],
      })
    case 'FINAL_CONFIRM_T24':
      return handleStateGatedEmail(event, 'FINAL_CONFIRM_T24', {
        requiredStates: ['BOOKED', 'PICKUP_CONFIRMED'],
      })
    case 'PICKUP_DAY_AM':
      return handleStateGatedEmail(event, 'PICKUP_DAY_AM', {
        requiredStates: ['BOOKED', 'PICKUP_CONFIRMED'],
      })
    case 'RETURN_REMINDER_T24':
      return handleStateGatedEmail(event, 'RETURN_REMINDER_T24', {
        requiredStates: ['BOOKED', 'PICKUP_CONFIRMED', 'IN_PROGRESS'],
      })
    case 'RETURN_ACKNOWLEDGMENT':
      return handleStateGatedEmail(event, 'RETURN_ACKNOWLEDGMENT', {
        requiredStates: ['IN_PROGRESS', 'RETURNED'],
      })
    case 'WRAP_THANKS_T24':
      return handleStateGatedEmail(event, 'WRAP_THANKS_T24', {
        requiredStates: ['RETURNED', 'INVOICED', 'PAID', 'WRAPPED'],
      })
    case 'INVOICE_DELIVERY':
      return handleStateGatedEmail(event, 'INVOICE_DELIVERY', {
        requiredStates: ['RETURNED', 'INVOICED'],
      })
    case 'PAYMENT_REMINDER_T14':
      return handleStateGatedEmail(event, 'PAYMENT_REMINDER_T14', {
        requiredStates: ['INVOICED'],
      })
    case 'REPEAT_BUSINESS_T30':
      return handleStateGatedEmail(event, 'REPEAT_BUSINESS_T30', {
        requiredStates: ['PAID', 'WRAPPED'],
      })

    // Still stubs — scheduling triggers + template copy not yet locked.
    case 'MID_RENTAL_CHECKIN':
    case 'LOST_REENGAGEMENT_2W':
    case 'LOST_SOFT_CHECKIN_90D':
    case 'ANNUAL_EXPIRY_60D':
    case 'ANNUAL_EXPIRY_30D':
    case 'ANNUAL_EXPIRY_7D':
    case 'PORTAL_SUNSET_REMINDER_23M':
      console.log(HANDLER_LABEL, 'stub-executed', event.eventType, 'order=', event.orderId)
      return {}
    default: {
      // Exhaustiveness: TypeScript will flag if a CadenceEventType is added
      // without a case here.
      const _exhaustive: never = event.eventType
      void _exhaustive
      return { skipped: true, reason: 'unknown-event-type' }
    }
  }
}

/**
 * Generic state-gated email handler. Used by every cadence event that just
 * sends an email and doesn't transition state. Returns `skipped` when:
 *   - context can't be loaded (order missing)
 *   - the order is not in one of `requiredStates` (event was scheduled
 *     against a state that's since advanced — typical mid-cadence skip)
 *   - no job contact email on file
 *   - optional: pickup is closer than `requirePickupHoursAhead` (e.g.
 *     QUOTE_NUDGE_24H and ACK_QUESTIONS_PROMPT_24H both want >48h)
 */
async function handleStateGatedEmail(
  event: EventWithOrder,
  eventType: CadenceEventType,
  opts: {
    requiredStates: import('@prisma/client').CadenceState[]
    requirePickupHoursAhead?: number
  },
): Promise<HandlerResult> {
  const ctx = await loadCadenceContextForOrder(event.orderId)
  if (!ctx) return { skipped: true, reason: 'order-missing' }
  if (!opts.requiredStates.includes(ctx.order.cadenceState)) {
    return { skipped: true, reason: `cadence-state=${ctx.order.cadenceState}` }
  }
  if (!ctx.jobContact?.email) {
    return { skipped: true, reason: 'no-job-contact-email' }
  }
  if (opts.requirePickupHoursAhead) {
    if (!ctx.order.startDate) return { skipped: true, reason: 'no-pickup-date' }
    const hoursAhead = (ctx.order.startDate.getTime() - Date.now()) / 3_600_000
    if (hoursAhead < opts.requirePickupHoursAhead) {
      return { skipped: true, reason: `pickup-too-close (${hoursAhead.toFixed(1)}h)` }
    }
  }

  const templateCtx = buildTemplateContext(ctx)
  const result = await sendCadenceEmail({
    eventType,
    label: `cadence/${eventType}`,
    to: [ctx.jobContact.email],
    from: { name: ctx.agent.name, email: ctx.agent.email },
    replyTo: ctx.agent.email,
    context: templateCtx,
  })
  if (!result.ok) {
    return { skipped: true, reason: `send-failed: ${result.reason}` }
  }
  return { emailId: result.id }
}

/**
 * QUOTE_LOST_MARK fires at pickup time. Whatever state the order is in dictates
 * the lostReason:
 *   - cadenceState=QUOTE_SENT → never replied → NO_RESPONSE
 *   - cadenceState=QUOTE_ACKNOWLEDGED → replied but didn't book → ACKNOWLEDGED_NO_BOOK
 *   - any other state → already advanced past the lost branch, skip
 *
 * No email send here — the cadence's last touchpoint is the CLOSEDOWN_T24
 * message; LOST is the state-machine bookend.
 */
async function handleQuoteLostMark(event: EventWithOrder): Promise<HandlerResult> {
  const ctx = await loadCadenceContextForOrder(event.orderId)
  if (!ctx) return { skipped: true, reason: 'order-missing' }
  const state = ctx.order.cadenceState
  if (state !== 'QUOTE_SENT' && state !== 'QUOTE_ACKNOWLEDGED' && state !== 'QUOTE_DISCUSSING') {
    return { skipped: true, reason: `already-past-quote (${state})` }
  }
  const lostReason = state === 'QUOTE_SENT' ? 'NO_RESPONSE' : 'ACKNOWLEDGED_NO_BOOK'
  await prisma.order.update({
    where: { id: ctx.order.id },
    data: {
      lostReason,
      lostAt: new Date(),
      pickupDateAtLoss: ctx.order.startDate,
    },
  })
  await transitionCadenceState(ctx.order.id, 'LOST')
  return {}
}
