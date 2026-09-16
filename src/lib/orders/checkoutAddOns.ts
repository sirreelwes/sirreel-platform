/**
 * Check-out add-ons — the extra straps, pads or dolly a driver asks for at
 * the last minute, added by fleet or the warehouse while they check the
 * order out.
 *
 * Wes 2026-09-16: "When the fleet or warehouse checks out a vehicle to a
 * driver, they often have add-ons like extra ratchet straps or furniture
 * pads, or something that the driver indicates that they need at the last
 * minute … very easy and user-friendly … ideally it gets collapsed into the
 * original order with notes on the fact that the driver requested these
 * things."
 *
 * One engine with the check-out sheet's written-in rows
 * (createWarehouseAddedLines, 2026-09-14): the gear becomes lines on the
 * ORIGINAL order, stamped warehouseAddedAt/By, priced off the client's rate
 * card when it is a catalog item, UNPRICED (blocking the invoice and the
 * corrected quote) when it is typed free-hand — never a silent $0. The line
 * note says the driver asked for it, so the order, the pull sheet and the
 * invoice all tell the same story.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createWarehouseAddedLines, type WarehouseAddedResult } from '@/lib/orders/warehouseAddedLines'
import { recalcOrderTotals } from '@/lib/orders'
import { syncPickListOnLineAdd } from '@/lib/orders/pickListSync'
import { syncOrderWindowSafe } from '@/lib/orders/syncOrderWindow'

export const CHECKOUT_ADDON_AUDIT_ACTION = 'order.checkout_addons'

/**
 * The one-tap chips, by catalog CODE (codes are stable; descriptions get
 * edited). Measured 2026-09-16 — each is a live, rated catalog row. A code
 * that stops resolving simply drops its chip; search still finds anything.
 */
export const QUICK_ADDON_CODES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'VEH-STRAPS-RATCHET', label: 'Ratchet straps' },
  { code: 'BAS-FURNITURE-PADS', label: 'Furniture pads' },
  { code: 'VEH-STRAPS-BUNGEE-OR-D-RING', label: 'Bungee / D-ring straps' },
  { code: 'DOL-DOLLY-HANDTRUCK-2-WHEEL', label: 'Hand truck' },
  { code: 'DOL-DOLLY-FURNITURE', label: 'Furniture dolly' },
  { code: 'BAS-TARP-LARGE', label: 'Tarp (large)' },
  { code: 'SAF-TRAFFIC-CONES-28', label: 'Traffic cones' },
]

export async function quickAddOns() {
  const rows = await prisma.inventoryItem.findMany({
    where: { code: { in: QUICK_ADDON_CODES.map((q) => q.code) } },
    select: { id: true, code: true, description: true },
  })
  const byCode = new Map(rows.map((r) => [r.code, r]))
  return QUICK_ADDON_CODES.flatMap((q) => {
    const r = byCode.get(q.code)
    return r ? [{ inventoryItemId: r.id, label: q.label, description: r.description }] : []
  })
}

/** Orders an add-on may still land on. A truck often leaves while the
 *  order still reads as a quote (the check-out sheet says so), so quotes
 *  count; once it is back, invoiced or cancelled, the agent adds it. */
const ADDABLE = new Set(['DRAFT', 'QUOTE_SENT', 'APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB'])

export class CheckoutAddOnError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

export interface CheckoutAddOnItem {
  inventoryItemId: string | null
  description: string
  quantity: number
}

/** The line note a client and an agent both read. */
export function addOnNote(driverName: string | null, note: string | null): string {
  const who = driverName?.trim()
  const base = who ? `Requested by the driver (${who}) at check-out` : 'Requested by the driver at check-out'
  const extra = note?.trim()
  return extra ? `${base} — ${extra}` : base
}

export async function addCheckoutAddOns(args: {
  orderId: string
  items: CheckoutAddOnItem[]
  driverName: string | null
  /** Who on the crew added it — the name on the line. */
  addedBy: string
  note: string | null
  userId: string
}): Promise<{ added: WarehouseAddedResult[]; unpriced: number; orderNumber: string }> {
  const items = args.items
    .map((i) => ({
      inventoryItemId: i.inventoryItemId || null,
      description: String(i.description || '').trim().slice(0, 300),
      quantity: Math.max(1, Math.min(999, Math.floor(Number(i.quantity) || 1))),
    }))
    .filter((i) => i.description)
  if (items.length === 0) throw new CheckoutAddOnError('Nothing to add.')
  if (!args.addedBy.trim()) throw new CheckoutAddOnError('Say who is adding it.')

  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: { id: true, orderNumber: true, status: true, companyId: true, startDate: true, endDate: true },
  })
  if (!order) throw new CheckoutAddOnError('Order not found.', 404)
  if (!ADDABLE.has(order.status)) {
    throw new CheckoutAddOnError(
      order.status === 'INVOICED' || order.status === 'CLOSED'
        ? `${order.orderNumber} is already invoiced — ask the agent to add it.`
        : `${order.orderNumber} is ${order.status.replace(/_/g, ' ').toLowerCase()} — ask the agent to add it.`,
      409,
    )
  }
  // A catalog id must be a real row — the browser picked it.
  const ids = items.map((i) => i.inventoryItemId).filter((x): x is string => !!x)
  if (ids.length) {
    const found = await prisma.inventoryItem.count({ where: { id: { in: ids } } })
    if (found !== new Set(ids).size) throw new CheckoutAddOnError('An item is no longer in the catalog — search again.')
  }

  const at = new Date()
  const note = addOnNote(args.driverName, args.note)
  const added = await prisma.$transaction(async (tx) => {
    const made = await createWarehouseAddedLines(tx, {
      order: { id: order.id, companyId: order.companyId, startDate: order.startDate, endDate: order.endDate },
      rows: items.map((i) => ({ ...i, note })),
      preppedBy: args.addedBy.trim(),
      at,
    })
    await tx.auditLog.create({
      data: {
        userId: args.userId,
        action: CHECKOUT_ADDON_AUDIT_ACTION,
        entityType: 'Order',
        entityId: order.id,
        oldValues: {},
        newValues: {
          addedBy: args.addedBy.trim(),
          driverName: args.driverName?.trim() || null,
          note: args.note?.trim() || null,
          lines: made.map((m) => ({
            orderLineItemId: m.orderLineItemId,
            description: m.description,
            quantity: m.quantity,
            rate: m.rate,
            unpriced: m.unpriced,
          })),
        } as Prisma.InputJsonValue,
      },
    })
    return made
  })

  // Same after-steps as the check-out sheet's adds: totals, the pick-list
  // lane, the order window. Non-fatal — the gear is already on the truck.
  await recalcOrderTotals(order.id).catch((err) => console.error('[checkout-addons] totals', err))
  for (const a of added) {
    await syncPickListOnLineAdd(prisma, {
      orderId: order.id,
      orderLineItemId: a.orderLineItemId,
      department: a.department,
    }).catch((err) => console.error('[checkout-addons] pick list', err))
  }
  await syncOrderWindowSafe(order.id)

  return { added, unpriced: added.filter((a) => a.unpriced).length, orderNumber: order.orderNumber }
}

/** What was added at check-out on an order, newest first — the order page's
 *  "Added at check-out" section and the card's own "already added" list. */
export async function checkoutAddedLines(orderId: string) {
  const lines = await prisma.orderLineItem.findMany({
    where: { orderId, warehouseAddedAt: { not: null } },
    orderBy: [{ warehouseAddedAt: 'desc' }, { sortOrder: 'asc' }],
    select: {
      id: true,
      description: true,
      quantity: true,
      rate: true,
      lineTotal: true,
      notes: true,
      warehouseAddedAt: true,
      warehouseAddedBy: true,
      pricingPendingAt: true,
    },
  })
  return lines.map((l) => ({
    id: l.id,
    description: l.description,
    quantity: l.quantity,
    rate: Number(l.rate),
    lineTotal: Number(l.lineTotal),
    note: l.notes,
    addedAt: l.warehouseAddedAt!.toISOString(),
    addedBy: l.warehouseAddedBy,
    unpriced: !!l.pricingPendingAt,
  }))
}
