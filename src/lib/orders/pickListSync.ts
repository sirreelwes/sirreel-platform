/**
 * PickList sync for post-BOOKED OrderLineItem mutations.
 *
 * Closes the PARKING LOT comment at bookOrder.ts:191-196 — post-book
 * line-item edits used to silently desync from the picking floor. This
 * helper keeps them aligned.
 *
 * Reuses `routeDepartment` from src/lib/orders/bookOrder.ts so the
 * lane/pickStatus assignment for new lines is byte-identical to what
 * the original book transition stamps. No forked logic.
 *
 * Three timing cases for ADD (#3a), per the ratified spec:
 *   (a) order has no PickList yet (booked with zero warehouse lines
 *       previously) → create the PickList in DRAFT + add the item.
 *   (b) order has a PickList in DRAFT or PICKING → append PickListItem.
 *   (c) order has a PickList that already terminated (READY_TO_STAGE,
 *       STAGED, LOADED) — the at-pickup sandbag case → append
 *       PickListItem ANYWAY. The list status stays put; the warehouse
 *       team sees one new PENDING_PICK item on a list they thought was
 *       done and physically pulls it. Never error — the rep is at the
 *       truck and needs the line saved.
 *
 * For DELETE (#3b):
 *   - PENDING_PICK / null pickStatus → clean delete; no special path.
 *   - PICKED / STAGED / LOADED → the caller must verify the operator
 *     confirmed the physical-pull-back consequence (gate lives in the
 *     route handler; helper just executes the delete + audit when the
 *     caller passes `confirmedPicked: true`).
 *   - After delete, if the PickList is now empty, advance it to
 *     CANCELLED so the warehouse view doesn't surface an empty stub.
 *   - The OrderLineItem-side audit (step 1) already captures
 *     pickStatus + fulfillmentLane on `order.line_item_removed`. This
 *     module adds a separate AuditLog row for the un-pick when the
 *     item was already physically picked — that's the "track the
 *     un-pick, not silently drop it" guarantee.
 */

import type { FulfillmentLane, LineItemPickStatus, Prisma, PrismaClient } from '@prisma/client'
import { routeDepartment } from './bookOrder'

type TxClient = PrismaClient | Prisma.TransactionClient

/** Stamps fulfillmentLane + pickStatus on a newly-created
 *  OrderLineItem and (when warehouse-routed) ensures a PickListItem
 *  exists for it. Fires after OrderLineItem.create + recalc.
 *
 *  Returns the resolved lane + whether a PickList was created or
 *  appended-to — used by the caller's audit row. */
export async function syncPickListOnLineAdd(
  tx: TxClient,
  args: {
    orderId: string
    orderLineItemId: string
    department: Parameters<typeof routeDepartment>[0]
  },
): Promise<{
  lane: FulfillmentLane
  pickStatus: LineItemPickStatus | null
  pickListAction: 'none' | 'appended' | 'created'
}> {
  const routing = routeDepartment(args.department)

  // Stamp lane / pickStatus on the new line. Mirrors bookOrder.ts:175.
  await tx.orderLineItem.update({
    where: { id: args.orderLineItemId },
    data: {
      fulfillmentLane: routing.lane,
      pickStatus: routing.pickStatus,
    },
  })

  // Only WAREHOUSE lines participate in the PickList. FLEET + STAGE
  // routings stamp lane but skip the picking-floor side.
  if (routing.lane !== 'WAREHOUSE') {
    return { lane: routing.lane, pickStatus: routing.pickStatus, pickListAction: 'none' }
  }

  // Find-or-create the PickList. One per Order — `orderId @unique`
  // on the model, so a single findUnique covers it.
  const existing = await tx.pickList.findUnique({
    where: { orderId: args.orderId },
    select: { id: true, status: true },
  })

  if (!existing) {
    // Case (a) — order booked with zero warehouse lines; PickList
    // never minted. Spin one up now in DRAFT.
    const created = await tx.pickList.create({
      data: { orderId: args.orderId, status: 'DRAFT' },
      select: { id: true },
    })
    await tx.pickListItem.create({
      data: { pickListId: created.id, orderLineItemId: args.orderLineItemId },
    })
    return { lane: routing.lane, pickStatus: routing.pickStatus, pickListAction: 'created' }
  }

  // Case (b) and (c) — append regardless of current PickList status.
  // The list's state is unchanged. If it was already READY_TO_STAGE
  // or beyond, the new item shows up as PENDING_PICK and the
  // warehouse team handles it on their floor view. We do NOT
  // auto-rewind the list to PICKING — that would override the
  // operator's existing state machine.
  await tx.pickListItem.create({
    data: { pickListId: existing.id, orderLineItemId: args.orderLineItemId },
  })
  return { lane: routing.lane, pickStatus: routing.pickStatus, pickListAction: 'appended' }
}

/** Pre-fetches the PickListItem for a line about to be deleted.
 *  Returns the picker-stamp metadata so the caller can (a) decide
 *  whether to require a physical-pull confirmation and (b) log the
 *  un-pick in AuditLog before the row vanishes. */
export async function readPickListItemForDelete(
  tx: TxClient,
  orderLineItemId: string,
): Promise<{
  pickListItemId: string
  pickListId: string
  scannedCode: string | null
  pickedById: string | null
  pickedAt: Date | null
} | null> {
  const row = await tx.pickListItem.findUnique({
    where: { orderLineItemId },
    select: {
      id: true,
      pickListId: true,
      scannedCode: true,
      pickedById: true,
      pickedAt: true,
    },
  })
  if (!row) return null
  return {
    pickListItemId: row.id,
    pickListId: row.pickListId,
    scannedCode: row.scannedCode,
    pickedById: row.pickedById,
    pickedAt: row.pickedAt,
  }
}

/** Executes the PickList side of a line deletion. Explicit — NOT via
 *  the schema's onDelete: Cascade — so:
 *    1. The picker-stamp metadata gets logged before vanishing.
 *    2. The PickList status can be recomputed (CANCELLED when empty).
 *
 *  Caller must already have verified the physical-pull confirmation
 *  if pickStatus was PICKED / STAGED / LOADED. This function trusts
 *  the gate decision; it just performs the bookkeeping. */
export async function syncPickListOnLineDelete(
  tx: TxClient,
  args: {
    orderId: string
    orderLineItemId: string
    /** Pre-fetched PickListItem from `readPickListItemForDelete`.
     *  Pass null when there's no PickListItem (the line was non-
     *  warehouse, or the order had no PickList). */
    pickListItem: {
      pickListItemId: string
      pickListId: string
      scannedCode: string | null
      pickedById: string | null
      pickedAt: Date | null
    } | null
    /** OrderLineItem.pickStatus at delete time. Drives the
     *  un-pick audit row. */
    pickStatusAtDelete: 'PENDING_PICK' | 'PICKED' | 'STAGED' | 'LOADED' | null
    /** Operator id (for AuditLog.userId). Nullable — AuditLog allows
     *  null userId. */
    userId: string | null
    /** Request IP (for AuditLog.ipAddress). */
    ipAddress: string | null
  },
): Promise<{ pickListRecomputed: 'unchanged' | 'cancelled_empty' | 'none' }> {
  if (!args.pickListItem) {
    // Non-warehouse line, or order has no PickList. Nothing to do
    // beyond what the OrderLineItem delete itself handles.
    return { pickListRecomputed: 'none' }
  }

  // (#3b) Un-pick audit row — captures the picker-stamp metadata
  // BEFORE the PickListItem vanishes. Anyone querying "what happened
  // to that PICKED item on order X?" finds this row with the
  // pickedById / pickedAt / scannedCode preserved.
  //
  // Only emitted when the line was already physically picked. A
  // PENDING_PICK deletion has nothing to track on this side; step 1's
  // OrderLineItem audit row covers the metadata.
  if (
    args.pickStatusAtDelete === 'PICKED' ||
    args.pickStatusAtDelete === 'STAGED' ||
    args.pickStatusAtDelete === 'LOADED'
  ) {
    try {
      await tx.auditLog.create({
        data: {
          userId: args.userId,
          ipAddress: args.ipAddress,
          action: 'picklist.item_picked_then_removed',
          entityType: 'PickListItem',
          entityId: args.pickListItem.pickListItemId,
          oldValues: {
            pickListId: args.pickListItem.pickListId,
            orderLineItemId: args.orderLineItemId,
            pickStatus: args.pickStatusAtDelete,
            scannedCode: args.pickListItem.scannedCode,
            pickedById: args.pickListItem.pickedById,
            pickedAt: args.pickListItem.pickedAt?.toISOString() ?? null,
          },
          newValues: { removedFromOrder: true },
        },
      })
    } catch (err) {
      // Non-fatal — same contract as step 1's audit helper.
      console.error('[pickListSync] un-pick audit failed:', err instanceof Error ? err.message : err)
    }
  }

  // Explicit PickListItem delete — replaces the silent schema cascade
  // so the deletion is an action, not a side-effect.
  await tx.pickListItem.delete({ where: { id: args.pickListItem.pickListItemId } })

  // Recompute PickList state. Conservative — only auto-advance when
  // the list is now empty (CANCELLED). For partial removal we leave
  // the existing PickListStatus alone; the operator advances it
  // explicitly via the /api/picklists/[id]/complete-picking endpoint.
  const remaining = await tx.pickListItem.count({ where: { pickListId: args.pickListItem.pickListId } })
  if (remaining === 0) {
    await tx.pickList.update({
      where: { id: args.pickListItem.pickListId },
      data: { status: 'CANCELLED' },
    })
    return { pickListRecomputed: 'cancelled_empty' }
  }
  return { pickListRecomputed: 'unchanged' }
}
