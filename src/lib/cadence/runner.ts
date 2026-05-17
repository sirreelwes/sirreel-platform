import { prisma } from '@/lib/prisma'
import type { CadenceEvent, CadenceEventType } from '@prisma/client'

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
 * Stub dispatch table — every event currently just logs. Phase 1.3 will
 * replace each entry with a real handler that renders a Handlebars template
 * and sends via Resend (using the sendAgreementEmail helper pattern that
 * surfaces failure rather than swallowing it).
 */
async function dispatch(event: EventWithOrder): Promise<HandlerResult> {
  switch (event.eventType) {
    // Currently a no-op for every event type. Marking executed so the runner
    // can be exercised end-to-end against synthetic data.
    case 'QUOTE_NUDGE_24H':
    case 'QUOTE_CHECKIN_T72':
    case 'QUOTE_CLOSEDOWN_T24':
    case 'QUOTE_LOST_MARK':
    case 'ACK_QUESTIONS_PROMPT_24H':
    case 'ACK_SWEETEN_T72':
    case 'ACK_CLOSEDOWN_T24':
    case 'BOOKING_WELCOME':
    case 'COI_RECEIVED_ACK':
    case 'PRE_PICKUP_DETAILS_T48':
    case 'FINAL_CONFIRM_T24':
    case 'PICKUP_DAY_AM':
    case 'MID_RENTAL_CHECKIN':
    case 'RETURN_REMINDER_T24':
    case 'RETURN_ACKNOWLEDGMENT':
    case 'WRAP_THANKS_T24':
    case 'INVOICE_DELIVERY':
    case 'PAYMENT_REMINDER_T14':
    case 'REPEAT_BUSINESS_T30':
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
