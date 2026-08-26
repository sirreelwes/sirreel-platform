/**
 * Orders list status — the ONE derived answer to "where is this order",
 * used by the /orders list and available to any other order surface that
 * needs the same pill.
 *
 * WHY DERIVED, and why this file exists at all:
 *
 * 1. THE LIST WAS SHOWING STATUSES THAT NO LONGER EXIST. /orders filtered
 *    and colored on CONFIRMED / ACTIVE — names retired in the Phase 1
 *    lifecycle rename (CONFIRMED→APPROVED, ACTIVE→ON_JOB). Picking either
 *    from the filter returned zero rows forever, and the six real statuses
 *    the rename introduced (APPROVED, BOOKED, LOADED_READY, ON_JOB,
 *    LD_CHECK, INVOICED) had no color entry, so they all fell through to
 *    the same grey neutral chip. An APPROVED order and an ON JOB order
 *    were visually identical.
 *
 * 2. LOST WAS INVISIBLE. The cadence runner (handleQuoteLostMark) and the
 *    reply classifier (EXPLICIT_REJECTION) both write `lostAt` +
 *    `lostReason` and move cadenceState to LOST — and neither touches
 *    `status`. So an order the system had already given up on kept
 *    rendering "QUOTE SENT" on this list indefinitely. `status` alone
 *    cannot answer the question; `lostAt` has to be read too.
 *
 * PRECEDENCE. quoteStatus WON wins over a stale lostAt (a client who came
 * back and booked is not lost). Otherwise lostAt/quoteStatus=LOST reads as
 * LOST. Otherwise the lifecycle status stands. Archive is orthogonal — a
 * visibility flag rendered as a separate tag, never as the status.
 */
import type { OrderStatus, OrderQuoteStatus, LostReason } from '@prisma/client'

export type OrderListState =
  | 'DRAFT'
  | 'QUOTE_SENT'
  | 'LOST'
  | 'APPROVED'
  | 'BOOKED'
  | 'LOADED_READY'
  | 'ON_JOB'
  | 'RETURNED'
  | 'LD_CHECK'
  | 'INVOICED'
  | 'CLOSED'
  | 'CANCELLED'

/** Every lifecycle status, in cycle order — the filter dropdown's source. */
export const ORDER_STATUSES: OrderStatus[] = [
  'DRAFT',
  'QUOTE_SENT',
  'APPROVED',
  'BOOKED',
  'LOADED_READY',
  'ON_JOB',
  'RETURNED',
  'LD_CHECK',
  'INVOICED',
  'CLOSED',
  'CANCELLED',
]

export const ORDER_STATE_LABEL: Record<OrderListState, string> = {
  DRAFT:        'Draft',
  QUOTE_SENT:   'Quote sent',
  LOST:         'Lost',
  APPROVED:     'Approved',
  BOOKED:       'Booked',
  LOADED_READY: 'Loaded / ready',
  ON_JOB:       'On job',
  RETURNED:     'Returned',
  LD_CHECK:     'L&D check',
  INVOICED:     'Invoiced',
  CLOSED:       'Closed',
  CANCELLED:    'Cancelled',
}

/**
 * Chip tone per state. Keyed to the same cadence/pill palette the Jobs
 * board and the Order detail header use, so a BOOKED order is the same
 * blue everywhere it appears.
 */
export const ORDER_STATE_CHIP: Record<OrderListState, string> = {
  DRAFT:        'bg-chip-neutral-bg text-chip-neutral-fg',
  QUOTE_SENT:   'bg-pill-quoted-bg text-pill-quoted-fg',
  LOST:         'bg-pill-lost-bg text-pill-lost-fg',
  APPROVED:     'bg-chip-good-bg text-chip-good-fg',
  BOOKED:       'bg-cadence-booked-bg text-cadence-booked-fg',
  LOADED_READY: 'bg-cadence-picking-today-bg text-cadence-picking-today-fg',
  ON_JOB:       'bg-cadence-on-rental-bg text-cadence-on-rental-fg',
  RETURNED:     'bg-cadence-returned-bg text-cadence-returned-fg',
  LD_CHECK:     'bg-chip-warn-bg text-chip-warn-fg',
  INVOICED:     'bg-cadence-invoiced-bg text-cadence-invoiced-fg',
  CLOSED:       'bg-cadence-wrapped-bg text-cadence-wrapped-fg',
  CANCELLED:    'bg-chip-bad-bg text-chip-bad-fg',
}

export interface OrderListStateInput {
  status: OrderStatus | string
  quoteStatus?: OrderQuoteStatus | string | null
  lostAt?: string | Date | null
}

export function deriveOrderListState(order: OrderListStateInput): OrderListState {
  // A won order is never lost, however stale the lost stamp is.
  if (order.quoteStatus !== 'WON' && (order.lostAt != null || order.quoteStatus === 'LOST')) {
    // CANCELLED keeps its own name — "we cancelled a booked rental" and
    // "we didn't win the quote" are different facts and reps act on them
    // differently. Only a non-terminal order reads as LOST.
    if (order.status !== 'CANCELLED') return 'LOST'
  }
  return (order.status as OrderListState) ?? 'DRAFT'
}

/**
 * Human-facing lost reasons for the "Mark lost" picker. The system-derived
 * values (NO_RESPONSE, ACKNOWLEDGED_NO_BOOK, EXPLICIT_REJECTION) are
 * deliberately absent — those are the cadence runner's to write, not a
 * rep's to claim. MANUAL_CLOSE stays out for the same reason: it says
 * nothing about WHY.
 */
export const LOST_REASON_CHOICES: { value: LostReason; label: string }[] = [
  { value: 'LOST_TO_COMPETITOR', label: 'Went with another vendor' },
  { value: 'BUDGET',             label: 'Budget' },
  { value: 'TIMING',             label: 'Timing / dates' },
  { value: 'SCOPE_CHANGED',      label: 'Scope changed or production cancelled' },
  { value: 'OTHER',              label: 'Other' },
]

export const LOST_REASON_LABEL: Record<LostReason, string> = {
  NO_RESPONSE:          'No response',
  ACKNOWLEDGED_NO_BOOK: 'Replied, never booked',
  EXPLICIT_REJECTION:   'Client declined',
  MANUAL_CLOSE:         'Closed by hand',
  LOST_TO_COMPETITOR:   'Went with another vendor',
  BUDGET:               'Budget',
  TIMING:               'Timing / dates',
  SCOPE_CHANGED:        'Scope changed or production cancelled',
  OTHER:                'Other',
}
