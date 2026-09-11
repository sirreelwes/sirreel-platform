/**
 * The database half of the discount waterfall (discountWaterfall.ts): load
 * an order's partner lines, judge them, and refuse an edit that pushes
 * SirReel below its floor on a partner's unit.
 *
 * Where the gate runs — every way a discount reaches a partner unit:
 *   - adding or raising an order / department discount (discounts routes)
 *   - changing a line's rate, days or quantity (line PUT) — any line, since
 *     a FIXED or flat-total order discount re-spreads when another line moves
 *   - sending the quote and marking the order booked: the backstop for what
 *     is not gated edit by edit (a partner unit added under an existing
 *     discount, a line deleted from under a flat total, a list rate changed)
 * Lowering or removing a discount is never refused.
 *
 * Every message names the partner, so none of this reaches a client surface.
 */
import { prisma } from '@/lib/prisma'
import { effectiveSharePercent } from '@/lib/sub-rentals/partnerShare'
import {
  applyMarginChange,
  evaluatePartnerLines,
  floorBreaches,
  floorMessage,
  type MarginChange,
  type MarginInputs,
  type PartnerLineMargin,
} from '@/lib/sub-rentals/discountWaterfall'

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function loadMarginInputs(orderId: string): Promise<MarginInputs | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      taxRate: true,
      discounts: { select: { id: true, scope: true, departmentKey: true, type: true, value: true, label: true } },
      lineItems: {
        select: {
          id: true, department: true, type: true, quantity: true, billableDays: true, rate: true, lineTotal: true,
          // A roster unit only: an ad-hoc gear sub-rental has no list rate or
          // deal to judge, and its vendor cost is typed by hand.
          subRentals: {
            where: { status: { not: 'CANCELLED' }, subcontractedVehicleId: { not: null } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: {
              id: true, vendorDailyRate: true, itemDescription: true,
              subcontractedVehicle: { select: { name: true, listDailyRate: true, discountPercent: true } },
              vendor: { select: { name: true, partnerSharePercent: true, partnerMaxSharePercent: true } },
            },
          },
        },
      },
    },
  })
  if (!order) return null

  const lines = order.lineItems.map((l) => ({ id: l.id, department: l.department, type: l.type, lineTotal: Number(l.lineTotal) }))
  const partnerLines = order.lineItems.flatMap((l) => {
    const s = l.subRentals[0]
    if (!s) return []
    return [{
      lineId: l.id,
      subRentalId: s.id,
      department: l.department,
      quantity: l.quantity,
      billableDays: l.billableDays,
      rate: Number(l.rate),
      lineTotal: Number(l.lineTotal),
      vendorName: s.vendor.name,
      unitName: s.subcontractedVehicle?.name ?? s.itemDescription,
      listDaily: num(s.subcontractedVehicle?.listDailyRate),
      sharePercent: effectiveSharePercent(s.subcontractedVehicle, s.vendor),
      maxSharePercent: num(s.vendor.partnerMaxSharePercent),
      committedDaily: num(s.vendorDailyRate),
    }]
  })
  return {
    taxRate: Number(order.taxRate),
    lines,
    discounts: order.discounts.map((d) => ({ id: d.id, scope: d.scope, departmentKey: d.departmentKey, type: d.type, value: Number(d.value), label: d.label })),
    partnerLines,
  }
}

export async function partnerMarginsForOrder(orderId: string): Promise<PartnerLineMargin[]> {
  const inputs = await loadMarginInputs(orderId)
  return inputs ? evaluatePartnerLines(inputs) : []
}

export type FloorGateResult =
  | { ok: true }
  | { ok: false; message: string; breaches: PartnerLineMargin[] }

/**
 * With a `change`: refuse only what the change makes worse. Without one (send
 * quote, mark booked): refuse while any partner unit sits below the floor.
 */
export async function partnerFloorGate(orderId: string, change?: MarginChange): Promise<FloorGateResult> {
  const inputs = await loadMarginInputs(orderId)
  if (!inputs || inputs.partnerLines.length === 0) return { ok: true }
  const after = evaluatePartnerLines(applyMarginChange(inputs, change))
  const breaches = change
    ? floorBreaches(evaluatePartnerLines(inputs), after)
    : after.filter((m) => m.status === 'declined')
  return breaches.length ? { ok: false, message: floorMessage(breaches), breaches } : { ok: true }
}
