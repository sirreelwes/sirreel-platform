/**
 * bookOrder — atomic APPROVED → BOOKED transition.
 *
 * Phase 1 / commit 3 of the lifecycle spine. This is the "Book it" action.
 * Runs inside a single Prisma transaction so all of (a) the order status
 * flip, (b) the booked-value snapshot, (c) per-line lane routing, and
 * (d) the audit-log entry either commit together or roll back together.
 *
 * Cadence projection runs AFTER the transaction commits (it manages its
 * own internal transaction via transitionCadenceState). Forward-only
 * semantics mean that if the order's cadenceState already advanced to
 * BOOKED via the portal-sign path, this projection no-ops and no
 * duplicate BOOKING_WELCOME email is scheduled. The whole point of the
 * monotonic guard.
 *
 * Lane routing by department (per Phase 1 confirmation, answer 5):
 *   VEHICLES                              → FLEET     (pickStatus null)
 *   STAGES                                → STAGE     (pickStatus null)
 *   COMMUNICATIONS, PRO_SUPPLIES,
 *   EXPENDABLES, GE, ART                  → WAREHOUSE (pickStatus PENDING_PICK)
 *
 * What this does NOT do:
 *   - Does not create BookingAssignment rows. The OrderLineItem doesn't
 *     carry a specific assetId — it carries assetCategoryId. Specific
 *     asset assignment is a separate fleet-team workflow via the
 *     existing /api/scheduling/booking-items/[id]/assign path. The
 *     fulfillmentLane=FLEET tag is the spine signal that says "this
 *     line wants a vehicle"; the existing scheduling layer handles
 *     the specific-asset binding.
 *   - Does not create a PickList row. Phase 2 builds that workflow off
 *     the (fulfillmentLane=WAREHOUSE, pickStatus=PENDING_PICK) tags
 *     written here.
 *   - Does not send a client-facing email. Cadence emails are scheduled
 *     by the projection helper only when projection actually advances
 *     state — sign path already fired BOOKING_WELCOME, this path is
 *     internal/ops.
 */

import { Prisma } from '@prisma/client'
import type {
  LineItemDepartment,
  FulfillmentLane,
  LineItemPickStatus,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { computeQuoteStatusSync } from '@/lib/orders/quoteStatus'
import { projectCadenceFromOrderStatus } from '@/lib/orders/cadenceProjection'

export interface LaneRouting {
  lane: FulfillmentLane
  pickStatus: LineItemPickStatus | null
}

export function routeDepartment(dept: LineItemDepartment): LaneRouting {
  switch (dept) {
    case 'VEHICLES':
      return { lane: 'FLEET', pickStatus: null }
    case 'STAGES':
      return { lane: 'STAGE', pickStatus: null }
    case 'COMMUNICATIONS':
    case 'PRO_SUPPLIES':
    case 'EXPENDABLES':
    case 'GE':
    case 'ART':
      return { lane: 'WAREHOUSE', pickStatus: 'PENDING_PICK' }
    default: {
      const _exhaustive: never = dept
      void _exhaustive
      // Defensive: any unmapped department defaults to WAREHOUSE so the
      // operator at least sees it in the pick queue and can re-route.
      return { lane: 'WAREHOUSE', pickStatus: 'PENDING_PICK' }
    }
  }
}

export type BookOrderResult =
  | {
      ok: true
      orderId: string
      bookedAt: Date
      bookedTotal: string
      laneCounts: Record<FulfillmentLane, number>
    }
  | { ok: false; status: number; error: string; currentStatus?: string }

export async function bookOrder(args: {
  orderId: string
  userId: string | null
  ipAddress?: string | null
}): Promise<BookOrderResult> {
  const { orderId, userId, ipAddress = null } = args

  // ── Phase 1: atomic transaction ────────────────────────────────
  // Done as a single $transaction so a half-booked order can't exist.
  let txResult:
    | {
        bookedAt: Date
        bookedTotal: Prisma.Decimal
        laneCounts: Record<FulfillmentLane, number>
      }
    | { abort: true; status: number; error: string; currentStatus?: string }

  try {
    txResult = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          subtotal: true,
          taxAmount: true,
          total: true,
          sentAt: true,
          wonAt: true,
          lostAt: true,
          lineItems: { select: { id: true, department: true } },
        },
      })
      if (!order) {
        return { abort: true as const, status: 404, error: 'order not found' }
      }

      // Guard: must be in APPROVED. Reject everything else explicitly.
      if (order.status !== 'APPROVED') {
        return {
          abort: true as const,
          status: 409,
          error:
            order.status === 'BOOKED'
              ? 'order already booked'
              : `order must be APPROVED to book (current: ${order.status})`,
          currentStatus: order.status,
        }
      }

      const bookedAt = new Date()

      // Snapshot booked-value fields from the live quote totals. These
      // are write-once — never overwritten by post-booking edits to
      // subtotal/taxAmount/total.
      const sync = computeQuoteStatusSync('BOOKED', {
        sentAt: order.sentAt,
        wonAt: order.wonAt,
        lostAt: order.lostAt,
      })
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'BOOKED',
          bookedSubtotal: order.subtotal,
          bookedTaxAmount: order.taxAmount,
          bookedTotal: order.total,
          bookedAt,
          ...sync,
        },
      })

      // Route line items by department. Counts feed the audit-log
      // newValues so we can answer "what got booked through which
      // lane?" without re-querying.
      const laneCounts: Record<FulfillmentLane, number> = {
        FLEET: 0,
        WAREHOUSE: 0,
        STAGE: 0,
      }
      for (const li of order.lineItems) {
        const routing = routeDepartment(li.department)
        laneCounts[routing.lane] += 1
        await tx.orderLineItem.update({
          where: { id: li.id },
          data: {
            fulfillmentLane: routing.lane,
            pickStatus: routing.pickStatus,
          },
        })
      }

      // AuditLog. action is `order.booked`; oldValues capture pre-book
      // state, newValues capture the snapshot + routing summary.
      await tx.auditLog.create({
        data: {
          userId,
          ipAddress,
          action: 'order.booked',
          entityType: 'Order',
          entityId: orderId,
          oldValues: {
            status: 'APPROVED',
            subtotal: order.subtotal.toString(),
            taxAmount: order.taxAmount.toString(),
            total: order.total.toString(),
          },
          newValues: {
            status: 'BOOKED',
            bookedSubtotal: order.subtotal.toString(),
            bookedTaxAmount: order.taxAmount.toString(),
            bookedTotal: order.total.toString(),
            bookedAt: bookedAt.toISOString(),
            laneCounts,
          },
        },
      })

      return {
        bookedAt,
        bookedTotal: order.total,
        laneCounts,
      }
    })
  } catch (err) {
    console.error('[bookOrder] transaction failed:', err)
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : 'book transaction failed',
    }
  }

  if ('abort' in txResult) {
    return {
      ok: false,
      status: txResult.status,
      error: txResult.error,
      currentStatus: txResult.currentStatus,
    }
  }

  // ── Phase 2: cadence projection (post-tx) ──────────────────────
  // Forward-only. If sign already advanced cadence to BOOKED, this is a
  // monotonic-skip and BOOKING_WELCOME does not re-schedule. If sign
  // never ran (operator-driven approval path), this fires the BOOKED
  // event plan which auto-schedules BOOKING_WELCOME and the rest.
  try {
    await projectCadenceFromOrderStatus(orderId, 'BOOKED')
  } catch (err) {
    console.error('[bookOrder] cadence projection failed:', err)
    // Non-fatal — the order is BOOKED. Cadence drift can be reconciled
    // separately; we don't want to roll back a successful book.
  }

  return {
    ok: true,
    orderId,
    bookedAt: txResult.bookedAt,
    bookedTotal: txResult.bookedTotal.toString(),
    laneCounts: txResult.laneCounts,
  }
}
