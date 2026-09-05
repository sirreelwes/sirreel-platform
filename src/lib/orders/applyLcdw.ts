/**
 * Put the damage waiver on an order, or take it off — the ONE place that
 * prices it.
 *
 * Lifted out of /api/orders/[id]/lcdw on 2026-09-05 so a client's election
 * in the portal can apply the fee without a rep re-typing it. Luis Salgado
 * (Subplot, S260905-001) elected LCDW in the job portal and approved the
 * quote 24 seconds later; the fee reached the order fifty minutes on, by
 * hand, and the client was never told the number had moved. The election
 * is a signed acceptance of $24/day/vehicle — there is no pricing judgment
 * left for a human to make, only arithmetic, and arithmetic should not
 * wait for someone to notice.
 *
 * Eligibility is not decided here — it lives in
 * src/lib/pricing/lcdwEligibility.ts, which encodes the rule the RENTAL
 * AGREEMENT already states and every client signs. This only applies it.
 *
 * ── The one thing this must never do ───────────────────────────────
 *
 * Charge for a vehicle the agreement excludes. A client who pays $24/day
 * believing their VideoVan is covered, and discovers at claim time that
 * the addendum excluded it, has been sold nothing — and found out in the
 * worst possible circumstance. So apply refuses outright when every
 * vehicle is excluded, and the result always reports what is NOT covered
 * alongside what is.
 *
 * Quantity is VEHICLE-DAYS (Σ qty × billable days across eligible lines
 * only), because the fee is per vehicle per day and the excluded ones
 * must not be in that sum.
 *
 * Totals: every path that writes a line recalcs the order afterwards
 * (recalcOrderTotals). The route this came from did not — the $96 line
 * landed on S260905-001 and Order.total stayed $800, which is what the
 * quote PDF and the approval email print. That is fixed here, and it is
 * why nothing may create the fee line without going through this file.
 */

import { prisma } from '@/lib/prisma'
import { recalcOrderTotals } from '@/lib/orders'
import { computeLineTotal } from '@/lib/orders/billing'
import {
  quoteLcdw,
  describeLcdwCoverage,
  LCDW_FEE_CODE,
  type LcdwCandidate,
  type LcdwQuote,
} from '@/lib/pricing/lcdwEligibility'
import { isMoneyEditable } from '@/lib/orders/editability'
import type { OrderStatus } from '@prisma/client'

export interface LcdwCoverageContext {
  order: {
    id: string
    orderNumber: string
    status: OrderStatus
    startDate: Date | null
    endDate: Date | null
    lineItems: Array<{
      id: string
      pickupDate: Date | null
      returnDate: Date | null
    }>
  }
  quote: LcdwQuote
  fee: { id: string; amount: unknown; unit: string; name: string } | null
  existing: { id: string } | undefined
}

export async function loadLcdwCoverage(orderId: string): Promise<LcdwCoverageContext | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, orderNumber: true, status: true, startDate: true, endDate: true,
      lineItems: {
        select: {
          id: true, description: true, department: true, quantity: true,
          billableDays: true, type: true, feeItemId: true,
          pickupDate: true, returnDate: true,
          inventoryItem: { select: { code: true } },
          // A line fulfilled by a partner's unit is not ours to waive.
          subRentals: { select: { id: true }, take: 1 },
        },
      },
    },
  })
  if (!order) return null

  const candidates: LcdwCandidate[] = order.lineItems
    // Fee lines are charges, not vehicles — never judge them.
    .filter((l) => l.type !== 'FEE')
    .map((l) => ({
      id: l.id,
      description: l.description,
      code: l.inventoryItem?.code ?? null,
      department: l.department,
      quantity: l.quantity,
      billableDays: l.billableDays,
      isPartnerVehicle: l.subRentals.length > 0,
    }))

  const fee = await prisma.feeItem.findFirst({
    where: { code: LCDW_FEE_CODE, isActive: true },
    select: { id: true, amount: true, unit: true, name: true },
  })
  const existing = fee
    ? order.lineItems.find((l) => l.type === 'FEE' && l.feeItemId === fee.id)
    : undefined

  return { order, quote: quoteLcdw(candidates), fee, existing }
}

export type ApplyLcdwResult =
  | {
      ok: true
      alreadyApplied: boolean
      lineId: string
      vehicleDays: number
      perDay: number
      total: number
      summary: string
      /** Human line for an email or an audit row, e.g.
       *  "Limited Collision Damage Waiver — 1 vehicle × 4 days at $24/day ($96.00)". */
      changeLine: string
    }
  | { ok: false; status: 404 | 409; reason: string }

/**
 * Add the LCDW fee line to an order (idempotent). Refuses, with a reason
 * a person can read, whenever the agreement would not actually cover
 * anything on the order.
 */
export async function applyLcdwToOrder(orderId: string): Promise<ApplyLcdwResult> {
  const ctx = await loadLcdwCoverage(orderId)
  if (!ctx) return { ok: false, status: 404, reason: 'Order not found' }

  if (!ctx.fee) {
    return {
      ok: false, status: 409,
      reason: `No active "${LCDW_FEE_CODE}" fee in the catalog — add it under Admin → Fees first.`,
    }
  }
  const perDay = Number(ctx.fee.amount)
  if (ctx.existing) {
    return {
      ok: true, alreadyApplied: true, lineId: ctx.existing.id,
      vehicleDays: ctx.quote.vehicleDays, perDay,
      total: perDay * ctx.quote.vehicleDays,
      summary: describeLcdwCoverage(ctx.quote),
      changeLine: describeChange(ctx.quote, perDay),
    }
  }
  if (!isMoneyEditable(ctx.order.status)) {
    return {
      ok: false, status: 409,
      reason: `Order ${ctx.order.orderNumber} is ${ctx.order.status.toLowerCase()} — its money is locked.`,
    }
  }
  if (ctx.quote.allExcluded) {
    return { ok: false, status: 409, reason: describeLcdwCoverage(ctx.quote) }
  }
  if (ctx.quote.eligible.length === 0) {
    return { ok: false, status: 409, reason: 'No vehicles on this order to cover.' }
  }
  if (ctx.quote.vehicleDays <= 0) {
    return {
      ok: false, status: 409,
      reason: 'The eligible vehicles have no billable days yet — set dates first.',
    }
  }

  // Window = span of the covered vehicles, falling back to the order's.
  // Line dates are required on OrderLineItem, so a fee with no derivable
  // window is refused rather than written with a guessed date.
  const eligibleIds = new Set(ctx.quote.eligible.map((e) => e.id))
  const covered = ctx.order.lineItems.filter((l) => eligibleIds.has(l.id))
  const starts = covered.map((l) => l.pickupDate).filter(Boolean) as Date[]
  const ends = covered.map((l) => l.returnDate).filter(Boolean) as Date[]
  const coverageStart =
    starts.length > 0 ? new Date(Math.min(...starts.map((d) => d.getTime()))) : ctx.order.startDate
  const coverageEnd =
    ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : ctx.order.endDate
  if (!coverageStart || !coverageEnd) {
    return {
      ok: false, status: 409,
      reason: 'The covered vehicles have no dates yet — set them before adding the waiver.',
    }
  }

  const maxSort = ctx.order.lineItems.length

  // Priced through the SAME helper every other line uses, rather than a
  // local qty × rate — the billing rules differ per department and a
  // second multiplication path is how totals quietly diverge.
  const lineTotal = computeLineTotal({
    department: 'VEHICLES',
    quantity: ctx.quote.vehicleDays,
    rate: perDay,
    billableDays: 1,
    rateType: 'FLAT',
  })

  const line = await prisma.orderLineItem.create({
    data: {
      orderId: ctx.order.id,
      type: 'FEE',
      department: 'VEHICLES',
      feeItemId: ctx.fee.id,
      lineTotal: Math.round(lineTotal * 100) / 100,
      // The waiver spans exactly the vehicles it covers, so its window
      // is their span — not the order's, which may reach wider for
      // gear that isn't covered.
      pickupDate: coverageStart,
      returnDate: coverageEnd,
      // The description carries the coverage on its face, so the client
      // reading the quote sees which vehicles it applies to without
      // having to reconcile it against the line items themselves.
      description:
        `Limited Collision Damage Waiver — ${ctx.quote.eligible.length} vehicle` +
        `${ctx.quote.eligible.length === 1 ? '' : 's'}` +
        (ctx.quote.excluded.length > 0
          ? ` (excludes ${ctx.quote.excluded.map((e) => e.description).join(', ')})`
          : ''),
      quantity: ctx.quote.vehicleDays,
      rate: perDay,
      billableDays: 1,
      rateType: 'FLAT',
      sortOrder: maxSort + 1,
    },
    select: { id: true },
  })

  await recalcOrderTotals(ctx.order.id)

  return {
    ok: true,
    alreadyApplied: false,
    lineId: line.id,
    vehicleDays: ctx.quote.vehicleDays,
    perDay,
    total: perDay * ctx.quote.vehicleDays,
    summary: describeLcdwCoverage(ctx.quote),
    changeLine: describeChange(ctx.quote, perDay),
  }
}

export type RemoveLcdwResult =
  | { ok: true; alreadyRemoved: boolean; removed: string | null; changeLine: string }
  | { ok: false; status: 404 | 409; reason: string }

/** Take the LCDW fee line off an order (idempotent). */
export async function removeLcdwFromOrder(orderId: string): Promise<RemoveLcdwResult> {
  const ctx = await loadLcdwCoverage(orderId)
  if (!ctx) return { ok: false, status: 404, reason: 'Order not found' }
  if (!ctx.existing) {
    return { ok: true, alreadyRemoved: true, removed: null, changeLine: 'Limited Collision Damage Waiver removed' }
  }
  if (!isMoneyEditable(ctx.order.status)) {
    return {
      ok: false, status: 409,
      reason: `Order ${ctx.order.orderNumber} is ${ctx.order.status.toLowerCase()} — its money is locked.`,
    }
  }
  await prisma.orderLineItem.delete({ where: { id: ctx.existing.id } })
  await recalcOrderTotals(ctx.order.id)
  return {
    ok: true, alreadyRemoved: false, removed: ctx.existing.id,
    changeLine: 'Limited Collision Damage Waiver removed (declined)',
  }
}

function describeChange(q: LcdwQuote, perDay: number): string {
  const n = q.eligible.length
  const money = (perDay * q.vehicleDays).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
  return (
    `Limited Collision Damage Waiver added — ${n} vehicle${n === 1 ? '' : 's'}, ` +
    `${q.vehicleDays} vehicle-day${q.vehicleDays === 1 ? '' : 's'} at $${perDay}/day ($${money})` +
    (q.excluded.length ? `; not covered: ${q.excluded.map((e) => e.description).join(', ')}` : '')
  )
}
