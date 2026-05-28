/**
 * Forward-only / monotonic OrderStatus → CadenceState projection.
 *
 * Phase 1 of the lifecycle spine. When an Order's lifecycle status moves,
 * the CRH cadence ladder should advance to *at least* the projected
 * state — never regress. Cron continues to schedule clock-based events
 * (T48 / T24 / pickup-AM / return-T24 / etc.) off `Order.startDate`, but
 * the lifecycle-meaning states themselves are now driven from
 * Order.status, not from the cron or the AI reply classifier.
 *
 * Projection table (OrderStatus → CadenceState):
 *
 *   DRAFT         → QUOTE_DRAFT
 *   QUOTE_SENT    → QUOTE_SENT
 *   APPROVED      → QUOTE_ACKNOWLEDGED   (operator-approve path without
 *                                         a portal-sign — sign already
 *                                         transitions cadence to BOOKED
 *                                         directly and forward-only keeps
 *                                         it there)
 *   BOOKED        → BOOKED
 *   LOADED_READY  → (no projection — preserves whatever is current)
 *   ON_JOB        → IN_PROGRESS
 *   RETURNED      → RETURNED
 *   LD_CHECK      → (no projection — preserves whatever is current)
 *   INVOICED      → INVOICED
 *   CLOSED        → PAID
 *   CANCELLED     → CANCELLED (explicit cancel; only fires from a non-
 *                              terminal current state — see guard)
 *
 * Monotonicity: projection only advances. If the projected target's
 * happy-path rank is ≤ the current rank, no-op. This means:
 *   - Sign path (which directly transitions cadence to BOOKED) is never
 *     dragged back to QUOTE_ACKNOWLEDGED by a subsequent Order.status =
 *     APPROVED write.
 *   - "Book it" operator action that projects BOOKED is a no-op for
 *     cadence when cadence is already at BOOKED (i.e. sign already
 *     happened) — so no double BOOKING_WELCOME email.
 *
 * Terminal/divergent guard: never project over LOST or CANCELLED. If
 * cadence already landed in one of those, projection is silently
 * skipped — the operator must explicitly fix state, not the sync.
 */

import { prisma } from '@/lib/prisma'
import type { OrderStatus, CadenceState } from '@prisma/client'
import { transitionCadenceState } from '@/lib/cadence/scheduler'

const ORDER_TO_CADENCE: Partial<Record<OrderStatus, CadenceState>> = {
  DRAFT: 'QUOTE_DRAFT',
  QUOTE_SENT: 'QUOTE_SENT',
  APPROVED: 'QUOTE_ACKNOWLEDGED',
  BOOKED: 'BOOKED',
  // LOADED_READY → no projection (lane rollup; preserves current)
  ON_JOB: 'IN_PROGRESS',
  RETURNED: 'RETURNED',
  // LD_CHECK → no projection (preserves current)
  INVOICED: 'INVOICED',
  CLOSED: 'PAID',
  CANCELLED: 'CANCELLED',
}

/**
 * Ordinal rank along the happy-path forward progression. Terminals
 * (LOST, CANCELLED) are sentinels and never used for forward comparison.
 * QUOTE_DISCUSSING shares a rank with QUOTE_ACKNOWLEDGED because the AI
 * reply classifier parks a discussing reply at the same logical depth.
 */
const CADENCE_RANK: Record<CadenceState, number> = {
  QUOTE_DRAFT: 0,
  QUOTE_SENT: 1,
  QUOTE_ACKNOWLEDGED: 2,
  QUOTE_DISCUSSING: 2,
  BOOKED: 3,
  PICKUP_CONFIRMED: 4,
  IN_PROGRESS: 5,
  RETURNED: 6,
  INVOICED: 7,
  PAID: 8,
  WRAPPED: 9,
  LOST: -1,
  CANCELLED: -1,
}

export interface ProjectionResult {
  advanced: boolean
  from?: CadenceState
  to?: CadenceState
  reason?: 'no-projection' | 'order-not-found' | 'terminal-state' | 'monotonic-skip'
}

/**
 * Apply the projection for the order's new lifecycle status. Idempotent
 * and safe to call from any OrderStatus mutation callsite. Loads the
 * current cadenceState fresh from the DB so concurrent writes don't
 * regress the cadence ladder.
 */
export async function projectCadenceFromOrderStatus(
  orderId: string,
  newStatus: OrderStatus,
): Promise<ProjectionResult> {
  const target = ORDER_TO_CADENCE[newStatus]
  if (!target) return { advanced: false, reason: 'no-projection' }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { cadenceState: true },
  })
  if (!order) return { advanced: false, reason: 'order-not-found' }

  // Terminal/divergent guard — once parked in LOST or CANCELLED, the
  // sync never overrides. Operator fixes state explicitly.
  if (order.cadenceState === 'LOST' || order.cadenceState === 'CANCELLED') {
    return { advanced: false, reason: 'terminal-state', from: order.cadenceState }
  }

  // Explicit cancel — always allowed from a live state. Bypasses the
  // rank check because CANCELLED's sentinel rank would otherwise fail.
  if (target === 'CANCELLED') {
    await transitionCadenceState(orderId, 'CANCELLED')
    return { advanced: true, from: order.cadenceState, to: 'CANCELLED' }
  }

  // Forward-only: target must out-rank current.
  if (CADENCE_RANK[target] <= CADENCE_RANK[order.cadenceState]) {
    return { advanced: false, reason: 'monotonic-skip', from: order.cadenceState, to: target }
  }

  await transitionCadenceState(orderId, target)
  return { advanced: true, from: order.cadenceState, to: target }
}
