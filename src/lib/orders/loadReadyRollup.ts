/**
 * recomputeAndMaybeAdvanceLoadReady — the Phase 3 BOOKED → LOADED_READY
 * rollup. Reads warehouse + fleet lane terminal-ness and atomically
 * advances the order when both lanes are done.
 *
 * Lane terminal definitions:
 *   - Warehouse: every WAREHOUSE-routed OrderLineItem has
 *     pickStatus = LOADED. (Or there are zero warehouse lines.)
 *   - Fleet:     order.fleetReadyAt is non-null. (Or there are zero
 *     fleet lines.) Today fleetReadyAt is stamped manually via
 *     /api/orders/[id]/fleet-ready; when the digital fleet checkout
 *     flow lands, it stamps the same field automatically.
 *   - Stage:     trivially terminal (no progression tracked). STAGE
 *     lines never gate the rollup. A STAGE-only order vacuously
 *     advances at book time.
 *
 * Forward-only: only advances from BOOKED → LOADED_READY. Never
 * regresses an order that's already past LOADED_READY (ON_JOB,
 * RETURNED, INVOICED, CLOSED, CANCELLED). Idempotent — re-running on
 * an already-LOADED_READY order is a no-op.
 *
 * On advance:
 *   1. Update order.status = LOADED_READY.
 *   2. AuditLog row (action='order.loaded_ready').
 *   3. Emit LOADED_AND_READY cadence event (scheduledFor = now).
 *      Idempotent via scheduleOneShotCadenceEvent — won't double-fire
 *      if a LOADED_AND_READY event already exists for this order.
 *
 * Safe to call from any trigger point — designed to be a small
 * always-correct read+write. Call sites today:
 *   - POST /api/picklists/[id]/load (after the bulk LOADED transition)
 *   - POST /api/orders/[id]/fleet-ready (after stamping fleetReadyAt)
 *   - Future: when fleet checkout flow ships, from its terminal
 *     transition.
 *
 * Does NOT call projectCadenceFromOrderStatus — per the Phase 1
 * projection table, OrderStatus.LOADED_READY has no CadenceState
 * peer. CadenceState stays at BOOKED so the existing booked-cadence
 * events keep firing on their clock.
 */

import type { FulfillmentLane, OrderStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { scheduleOneShotCadenceEvent } from '@/lib/cadence/scheduler'

export type LoadReadyRollupResult =
  | { advanced: true; from: OrderStatus; to: 'LOADED_READY'; cadenceEventScheduled: boolean }
  | { advanced: false; reason: string; currentStatus?: OrderStatus; pending?: PendingSummary }

interface PendingSummary {
  warehouseTotal: number
  warehouseLoaded: number
  fleetTotal: number
  fleetReady: boolean
}

export async function recomputeAndMaybeAdvanceLoadReady(
  orderId: string,
): Promise<LoadReadyRollupResult> {
  // ── Load the inputs the rollup needs ───────────────────────────
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      fleetReadyAt: true,
      lineItems: {
        select: {
          fulfillmentLane: true,
          pickStatus: true,
        },
      },
    },
  })
  if (!order) return { advanced: false, reason: 'order-not-found' }

  // ── Forward-only / idempotency guard ──────────────────────────
  if (order.status !== 'BOOKED') {
    return {
      advanced: false,
      reason: order.status === 'LOADED_READY' ? 'already-loaded-ready' : 'not-bookable',
      currentStatus: order.status,
    }
  }

  // ── Compute lane terminal-ness ────────────────────────────────
  const warehouseLines = order.lineItems.filter(
    (li) => li.fulfillmentLane === ('WAREHOUSE' satisfies FulfillmentLane),
  )
  const fleetLines = order.lineItems.filter(
    (li) => li.fulfillmentLane === ('FLEET' satisfies FulfillmentLane),
  )

  const warehouseLoaded = warehouseLines.filter((li) => li.pickStatus === 'LOADED').length
  const warehouseDone = warehouseLines.length === 0 || warehouseLoaded === warehouseLines.length
  const fleetDone = fleetLines.length === 0 || order.fleetReadyAt != null

  if (!warehouseDone || !fleetDone) {
    return {
      advanced: false,
      reason: !warehouseDone && !fleetDone
        ? 'both-lanes-pending'
        : !warehouseDone
          ? 'warehouse-pending'
          : 'fleet-pending',
      currentStatus: order.status,
      pending: {
        warehouseTotal: warehouseLines.length,
        warehouseLoaded,
        fleetTotal: fleetLines.length,
        fleetReady: order.fleetReadyAt != null,
      },
    }
  }

  // ── Both lanes terminal: advance atomically ───────────────────
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'LOADED_READY' },
    })
    await tx.auditLog.create({
      data: {
        action: 'order.loaded_ready',
        entityType: 'Order',
        entityId: orderId,
        oldValues: { status: 'BOOKED' },
        newValues: {
          status: 'LOADED_READY',
          warehouseTotal: warehouseLines.length,
          warehouseLoaded,
          fleetTotal: fleetLines.length,
          fleetReady: order.fleetReadyAt != null,
        },
      },
    })
  })

  // ── Emit the client-facing cadence event ──────────────────────
  // Idempotent via scheduleOneShotCadenceEvent — if a LOADED_AND_READY
  // row already exists for this order (e.g. earlier rollup attempt),
  // it returns scheduled:false rather than creating a duplicate.
  let cadenceEventScheduled = false
  try {
    const res = await scheduleOneShotCadenceEvent({
      orderId,
      eventType: 'LOADED_AND_READY',
    })
    cadenceEventScheduled = res.scheduled
  } catch (err) {
    console.error('[loadReadyRollup] cadence event scheduling failed:', err)
    // Non-fatal — order is LOADED_READY. Cadence drift is recoverable
    // separately; we don't want to roll back the state advance.
  }

  return {
    advanced: true,
    from: 'BOOKED' as OrderStatus,
    to: 'LOADED_READY',
    cadenceEventScheduled,
  }
}
