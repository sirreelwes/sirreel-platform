/**
 * The two ways the DOCK writes a line onto an order — an addition and a
 * swap — both from the check-out report and from nowhere else.
 *
 * Wes, 2026-09-12: "On RW they had the ability to actually make the swap
 * and/or add a line item. This is crucial, because the driver needs a
 * copy of the exact order they're picking up." Until now an added row
 * was recorded on the report and flagged to the agent, never written
 * (the yard cannot see rates, and a line at $0 would under-bill the
 * job). The driver's receipt settles it the other way: the line goes on
 * the order NOW, priced from the catalog when the dock picked a catalog
 * row, at $0 and loudly UNPRICED when it typed a name — and either way
 * it carries the red flag (OrderLineItem.warehouseChange) the agent
 * reviews. What is added or swapped, the client sees; the flag, only
 * staff.
 *
 * Deliberately narrower than POST /api/orders/[id]/line-items: no
 * vehicles or stages (the picker offers QUANTITY gear only, so no holds,
 * no bookings, no capacity check), no weekly-deal detection, no kit
 * expansion. It prices the way the catalog prices a day and leaves the
 * judgement to the flag.
 */

import { Prisma, type LineItemType } from '@prisma/client'
import { estimateRentalDays } from '@/lib/orders'
import { computeLineTotal } from '@/lib/orders/billing'
import { computeDays } from '@/lib/orders/days'
import { syncPickListOnLineAdd } from '@/lib/orders/pickListSync'
import { resolveRate } from '@/lib/pricing/resolveRate'

type Tx = Prisma.TransactionClient

/** The catalog rows the dock may put on an order: warehouse gear only. */
export async function dockCatalogItems(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map<string, DockCatalogItem>()
  const rows = await tx.inventoryItem.findMany({
    where: { id: { in: unique }, isActive: true, trackingMode: 'QUANTITY' },
    select: { id: true, code: true, description: true, department: true, clientNote: true },
  })
  return new Map(rows.map((r) => [r.id, r]))
}
export type DockCatalogItem = {
  id: string
  code: string
  description: string | null
  department: Prisma.InventoryItemGetPayload<{ select: { department: true } }>['department']
  clientNote: string | null
}

const typeFor = (department: DockCatalogItem['department']): LineItemType =>
  department === 'EXPENDABLES' ? 'EXPENDABLE' : 'EQUIPMENT'

export interface DockAddInput {
  orderId: string
  description: string
  quantity: number
  /** Resolved and validated by the caller (dockCatalogItems). */
  item: DockCatalogItem | null
  userId: string
  at: Date
}

export interface DockAddResult {
  lineItemId: string
  description: string
  quantity: number
  /** False = no catalog rate reached it; the line is on the order at $0
   *  and the agent has to price it before the client is sent anything. */
  priced: boolean
}

export async function addLineFromDock(tx: Tx, input: DockAddInput): Promise<DockAddResult> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: input.orderId },
    select: { companyId: true, startDate: true, endDate: true },
  })
  // The order's window, the way a line added by sales inherits it. An
  // order with no dates yet bills the line as one day, today.
  const pickup = order.startDate ?? new Date()
  const ret = order.endDate ?? pickup

  const department = input.item?.department ?? 'PRO_SUPPLIES'
  const rates = input.item
    ? await resolveRate({ inventoryItemId: input.item.id, companyId: order.companyId }, tx)
    : { dailyRate: null }
  const rate = rates.dailyRate ?? new Prisma.Decimal(0)
  const billableDays = estimateRentalDays(pickup, ret)
  const lineTotal = computeLineTotal({
    quantity: input.quantity,
    rate: rate.toNumber(),
    billableDays,
    rateType: 'DAILY',
    department,
  })

  const maxSort = await tx.orderLineItem.aggregate({ where: { orderId: input.orderId }, _max: { sortOrder: true } })

  const line = await tx.orderLineItem.create({
    data: {
      orderId: input.orderId,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      type: typeFor(department),
      department,
      description: input.description,
      inventoryItemId: input.item?.id ?? null,
      pickupDate: pickup,
      returnDate: ret,
      rateType: 'DAILY',
      rate,
      resolvedRate: rates.dailyRate ?? null,
      rateOverridden: false,
      quantity: input.quantity,
      billableDays,
      computedDays: computeDays(pickup, ret),
      lineTotal: Math.round(lineTotal * 100) / 100,
      notes: input.item?.clientNote?.trim() ? input.item.clientNote : null,
      warehouseChange: 'ADDED',
      warehouseChangeAt: input.at,
      warehouseChangeById: input.userId,
    },
    select: { id: true },
  })

  // Same lane routing a sales add gets. It lands PENDING_PICK; the
  // complete check-out sheet that carries it marks every warehouse line
  // LOADED right after (settleGearAfterReport).
  await syncPickListOnLineAdd(tx, { orderId: input.orderId, orderLineItemId: line.id, department })

  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: 'order.line_added_at_dock',
      entityType: 'OrderLineItem',
      entityId: line.id,
      oldValues: {},
      newValues: {
        orderId: input.orderId,
        description: input.description,
        quantity: input.quantity,
        inventoryItemId: input.item?.id ?? null,
        code: input.item?.code ?? null,
        rate: rate.toString(),
        priced: rates.dailyRate != null,
      },
    },
  })

  return {
    lineItemId: line.id,
    description: input.description,
    quantity: input.quantity,
    priced: rates.dailyRate != null,
  }
}

export interface DockSwapInput {
  lineItemId: string
  /** The line as it will read now. */
  description: string
  quantity: number
  /** The catalog row swapped IN, when the dock picked one. */
  item: DockCatalogItem | null
  /** What it replaced — the report's substituteFor. */
  substituteFor: string
  userId: string
  at: Date
}

/**
 * A swap keeps the line: its rate, its dates, its history and its id.
 * What changes is what the line IS — the name, and the catalog row when
 * one was picked (so the pick list prints the right code and a barcoded
 * swap-in scans against the right line). The first swap's "from" is
 * kept on a second swap: it is the line the client approved.
 */
export async function swapLineFromDock(tx: Tx, input: DockSwapInput): Promise<void> {
  const before = await tx.orderLineItem.findUniqueOrThrow({
    where: { id: input.lineItemId },
    select: { description: true, inventoryItemId: true, department: true, warehouseChangeFrom: true },
  })
  const department = input.item?.department ?? before.department
  await tx.orderLineItem.update({
    where: { id: input.lineItemId },
    data: {
      description: input.description,
      quantity: input.quantity,
      ...(input.item
        ? { inventoryItemId: input.item.id, department, type: typeFor(department) }
        : {}),
      warehouseChange: 'SWAPPED',
      warehouseChangeAt: input.at,
      warehouseChangeById: input.userId,
      warehouseChangeFrom: before.warehouseChangeFrom ?? input.substituteFor,
    },
  })
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: 'order.line_swapped_at_dock',
      entityType: 'OrderLineItem',
      entityId: input.lineItemId,
      oldValues: { description: before.description, inventoryItemId: before.inventoryItemId },
      newValues: {
        description: input.description,
        inventoryItemId: input.item?.id ?? before.inventoryItemId,
        substituteFor: input.substituteFor,
        quantity: input.quantity,
      },
    },
  })
}
