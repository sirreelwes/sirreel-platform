import type { OrderStatus, OrderQuoteStatus } from '@prisma/client'

/**
 * Phase 1 sales pipeline rework: `Order.status` (full lifecycle) and
 * `Order.quoteStatus` (sales-stage view) live in parallel. The two fields
 * stay in sync via this helper — every code path that mutates `status`
 * must also write the derived `quoteStatus` (and stamp the relevant
 * sales-stage timestamp the first time it transitions).
 *
 * Mapping (per Wes 2026-05-08):
 *   DRAFT       → DRAFT
 *   QUOTE_SENT  → SENT
 *   CONFIRMED   → WON     (client signed; lifecycle continues on `status`)
 *   ACTIVE      → WON
 *   RETURNED    → WON
 *   CLOSED      → WON
 *   CANCELLED   → LOST
 *
 * EXPIRED has no `status`-side counterpart — it is set later by an auto-
 * expiry mechanism (out of Phase 1 scope) and does NOT round-trip back
 * through this helper.
 */
export function deriveQuoteStatus(status: OrderStatus): OrderQuoteStatus {
  switch (status) {
    case 'DRAFT':
      return 'DRAFT'
    case 'QUOTE_SENT':
      return 'SENT'
    case 'CONFIRMED':
    case 'ACTIVE':
    case 'RETURNED':
    case 'CLOSED':
      return 'WON'
    case 'CANCELLED':
      return 'LOST'
    default: {
      // Exhaustiveness: if a new OrderStatus is added without updating
      // this mapping, TypeScript will flag the assignment.
      const _exhaustive: never = status
      void _exhaustive
      return 'DRAFT'
    }
  }
}

interface CurrentSalesStageTimestamps {
  sentAt: Date | null
  wonAt: Date | null
  lostAt: Date | null
}

/**
 * Build the data partial to apply alongside an Order.status mutation.
 *
 * Returns the next quoteStatus plus any first-time timestamp stamps
 * (sentAt/wonAt/lostAt are write-once — only set when null and the
 * transition newly enters that state). Callers spread the result into
 * their `prisma.order.update({ data: { ... } })` payload.
 *
 *   const sync = computeQuoteStatusSync(nextStatus, current, now)
 *   await prisma.order.update({ where: { id }, data: { status: nextStatus, ...sync } })
 */
export function computeQuoteStatusSync(
  nextStatus: OrderStatus,
  current: CurrentSalesStageTimestamps,
  now: Date = new Date()
): {
  quoteStatus: OrderQuoteStatus
  sentAt?: Date
  wonAt?: Date
  lostAt?: Date
} {
  const quoteStatus = deriveQuoteStatus(nextStatus)
  const out: ReturnType<typeof computeQuoteStatusSync> = { quoteStatus }
  if (quoteStatus === 'SENT' && current.sentAt == null) out.sentAt = now
  if (quoteStatus === 'WON' && current.wonAt == null) out.wonAt = now
  if (quoteStatus === 'LOST' && current.lostAt == null) out.lostAt = now
  return out
}
