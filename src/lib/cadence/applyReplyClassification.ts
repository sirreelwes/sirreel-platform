import { prisma } from '@/lib/prisma'
import type { ReplyClassification } from '@prisma/client'
import { transitionCadenceState } from '@/lib/cadence/scheduler'

const DISCUSSING_PAUSE_DAYS = 30

/**
 * Bridges the AI reply classifier output (src/lib/email/replyClassifier.ts)
 * to a cadence state action. Called after an inbound reply has been
 * classified and the classification persisted on EmailMessage.
 *
 * Order linkage heuristic — required because EmailMessage doesn't have a
 * direct FK to Order:
 *   - If the email is matched to a Company AND that company has exactly ONE
 *     open quote order (cadenceState in QUOTE_SENT or QUOTE_ACKNOWLEDGED),
 *     act on that order.
 *   - Otherwise skip with reason. (Multi-order companies will need richer
 *     linking — likely thread→order, deferred to a later phase.)
 *
 * Classification → action:
 *   - PURE_ACKNOWLEDGMENT      → transition to QUOTE_ACKNOWLEDGED
 *   - ACTIVE_DISCUSSION        → pause cadence (cadencePausedUntil = +30d)
 *   - BOOKING_SIGNAL           → log + emit operator alert; DO NOT
 *                                auto-transition (rep handles the booking)
 *   - EXPLICIT_REJECTION       → pause cadence only; the LOST call is a
 *                                human's (JobEmailSignal suggestion —
 *                                see src/lib/email/jobChangeSignals.ts)
 *   - UNCLEAR (post-floor: should be ACTIVE_DISCUSSION already, but defensive)
 *                              → pause cadence
 */

export interface ApplyClassificationInput {
  emailMessageId: string
  classification: ReplyClassification
  /** Effective classification after the brief §13 confidence floor. */
  effectiveClassification: ReplyClassification
  companyId: string | null
}

export interface ApplyClassificationResult {
  applied: boolean
  reason: string
  orderId?: string
  newState?: string
}

export async function applyReplyClassificationToCadence(
  input: ApplyClassificationInput,
): Promise<ApplyClassificationResult> {
  if (!input.companyId) {
    return { applied: false, reason: 'no-company-link' }
  }

  const openQuotes = await prisma.order.findMany({
    where: {
      companyId: input.companyId,
      cadenceState: { in: ['QUOTE_SENT', 'QUOTE_ACKNOWLEDGED'] },
    },
    select: { id: true, cadenceState: true },
  })
  if (openQuotes.length === 0) {
    return { applied: false, reason: 'no-open-quote-orders' }
  }
  if (openQuotes.length > 1) {
    console.warn(
      '[apply-classification] multiple open quotes for company',
      input.companyId,
      '— skipping auto-transition (need thread→order linking)',
    )
    return { applied: false, reason: `ambiguous: ${openQuotes.length} open quotes` }
  }

  const order = openQuotes[0]
  const action = input.effectiveClassification

  switch (action) {
    case 'PURE_ACKNOWLEDGMENT': {
      if (order.cadenceState === 'QUOTE_ACKNOWLEDGED') {
        return { applied: false, reason: 'already-acknowledged', orderId: order.id }
      }
      await transitionCadenceState(order.id, 'QUOTE_ACKNOWLEDGED')
      return { applied: true, reason: 'transitioned', orderId: order.id, newState: 'QUOTE_ACKNOWLEDGED' }
    }
    case 'ACTIVE_DISCUSSION':
    case 'UNCLEAR': {
      // Pause cadence rather than transitioning to QUOTE_DISCUSSING — that
      // state has no scheduled events of its own (rep handles manually), so
      // a pause is operationally equivalent. We surface the pause via
      // cadencePausedUntil so the rep can see when it expires and the
      // runner's safety gate fires correctly.
      const pausedUntil = new Date(Date.now() + DISCUSSING_PAUSE_DAYS * 86_400_000)
      await prisma.order.update({
        where: { id: order.id },
        data: { cadencePausedUntil: pausedUntil, cadenceState: 'QUOTE_DISCUSSING' },
      })
      return { applied: true, reason: 'paused-discussing', orderId: order.id, newState: 'QUOTE_DISCUSSING' }
    }
    case 'BOOKING_SIGNAL': {
      // Don't auto-transition — booking requires a signed agreement. Log so
      // the rep notification path (Phase 2.3 / 3.x — Slack DM) can light up.
      console.log(
        '[apply-classification] BOOKING_SIGNAL on order',
        order.id,
        '— rep notification not yet wired (TODO Slack)',
      )
      return { applied: false, reason: 'booking-signal-alert-only', orderId: order.id }
    }
    case 'EXPLICIT_REJECTION': {
      // Deliberately NOT auto-marked lost. Wes 2026-09-11: a client's
      // cancelling or changing a job carries nuance ("cancel the cube" is
      // not "cancel the job"; "project got cancelled" may be one of three
      // orders), so any change to HQ from an email is gated behind a human.
      // The suggestion is raised by src/lib/email/jobChangeSignals.ts
      // (JobEmailSignal, shown on the job page + Action Items); the rep
      // marks the order lost through the existing controls. Pause the
      // cadence so no follow-up nudge goes out on a quote the client just
      // declined.
      const pausedUntil = new Date(Date.now() + DISCUSSING_PAUSE_DAYS * 86_400_000)
      await prisma.order.update({
        where: { id: order.id },
        data: { cadencePausedUntil: pausedUntil },
      })
      return { applied: false, reason: 'rejection-suggested-not-applied', orderId: order.id }
    }
    default: {
      const _exhaustive: never = action
      void _exhaustive
      return { applied: false, reason: `unhandled-classification: ${action as string}` }
    }
  }
}
