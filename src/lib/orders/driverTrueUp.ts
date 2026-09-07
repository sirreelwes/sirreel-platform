/**
 * The driver line, trued up from the hours actually worked.
 *
 * Wes 2026-09-07: "now wire the actual hours to the invoice." A driver line
 * is quoted as an estimated day (driverEstimate.ts) and priced by the
 * ladder (driverRate.ts). When the day is over the driver logs what really
 * happened — left lot, on set, left set, wrap — and THAT is what the client
 * owes. This module is the bridge: it prices the logged days by the same
 * ladder and reports the difference against the quoted line.
 *
 * ── Nothing is applied automatically ────────────────────────────────────
 * The invoice generator reads the LIVE order lines, so writing the actual
 * amount onto the line is what puts it on the invoice — which is exactly
 * why it takes a human click. Same rule as the yard's check-in
 * (`nothing bills automatically, that stays a human decision`) and the
 * kit-piece reconciler. After booking, the change also shows on the
 * invoice as an explicit ADJUSTMENT rather than silent drift, because
 * generateRentalInvoice anchors its total to the booked snapshot.
 *
 * ── What can be trued up ────────────────────────────────────────────────
 * Only a driver line whose PARENT vehicle line is fulfilled by a partner
 * booking (SubRental.orderLineItemId), because that booking is what the
 * driver's hours hang off. A driver line with no such link is reported with
 * a reason and never guessed at — a wrong link here would move money.
 */
import { prisma } from '@/lib/prisma'
import { computePortalHours } from '@/lib/drivers/hoursEntry'
import { computeDriverPay, driverPayBreakdown, type DriverPay } from '@/lib/orders/driverRate'
import { computeLineTotal } from '@/lib/orders/billing'
import { recalcOrderTotals } from '@/lib/orders'

export interface TrueUpDay {
  workDate: string
  /** Portal-to-portal span for the day, from the driver's own stamps. */
  spanHours: number
  pay: DriverPay
}

export interface DriverTrueUp {
  lineId: string
  description: string
  /** What the order currently charges for this line. */
  quoted: number
  /** The logged days, priced. Empty when nothing has been logged yet. */
  days: TrueUpDay[]
  actualHours: number
  actualPay: number
  /** actualPay − quoted. Positive means the client owes more. */
  delta: number
  /** Human sentence for the surfaces. */
  summary: string
  /** False when the line cannot be trued up automatically, with why. */
  applicable: boolean
  blockedReason: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** A driver fee line — the only line this applies to. */
function isDriverLine(li: { description: string; type: string; parentLineItemId: string | null }): boolean {
  return /\bdrivers?\b/i.test(li.description) && (li.type === 'FEE' || li.type === 'LABOR' || !!li.parentLineItemId)
}

export async function driverTrueUpForOrder(orderId: string): Promise<DriverTrueUp[]> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      lineItems: {
        select: {
          id: true, description: true, type: true, parentLineItemId: true,
          rate: true, quantity: true, billableDays: true, rateType: true,
          department: true, lineTotal: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
  if (!order) return []
  const driverLines = order.lineItems.filter(isDriverLine)
  if (driverLines.length === 0) return []

  const out: DriverTrueUp[] = []
  for (const line of driverLines) {
    const quoted = round2(Number(line.lineTotal))
    const base: DriverTrueUp = {
      lineId: line.id, description: line.description, quoted,
      days: [], actualHours: 0, actualPay: 0, delta: 0,
      summary: '', applicable: false, blockedReason: null,
    }

    // The partner booking behind this line is what the hours hang off: it
    // is linked to the PARENT vehicle line, not to the fee line itself.
    const anchorLineId = line.parentLineItemId ?? line.id
    const sub = await prisma.subRental.findFirst({
      where: { orderLineItemId: anchorLineId, status: { not: 'CANCELLED' } },
      select: { id: true, driverName: true },
    })
    if (!sub) {
      out.push({ ...base, blockedReason: 'No partner booking is linked to this line, so there are no logged hours to read. Link the sub-rental to the vehicle line first.', summary: 'Not linked to a partner booking.' })
      continue
    }

    const entries = await prisma.driverHoursEntry.findMany({
      where: { subRentalId: sub.id },
      orderBy: { workDate: 'asc' },
      select: { workDate: true, startTime: true, onSetTime: true, leftSetTime: true, endTime: true, hours: true },
    })
    const days: TrueUpDay[] = []
    for (const e of entries) {
      const r = computePortalHours({ leftLot: e.startTime, onSet: e.onSetTime, leftSet: e.leftSetTime, wrap: e.endTime })
      // The stamps are the source of truth; the stored `hours` is the
      // fallback for a day logged before all four were captured.
      const span = r.ok && r.hours !== null ? r.hours : e.hours !== null ? Number(e.hours) : null
      if (span === null) continue
      days.push({ workDate: e.workDate.toISOString().slice(0, 10), spanHours: round2(span), pay: computeDriverPay(span) })
    }
    if (days.length === 0) {
      out.push({ ...base, blockedReason: `${sub.driverName ?? 'The driver'} has not logged hours yet.`, summary: 'No hours logged yet.' })
      continue
    }

    const actualHours = round2(days.reduce((n, d) => n + d.spanHours, 0))
    const actualPay = round2(days.reduce((n, d) => n + d.pay.total, 0))
    const delta = round2(actualPay - quoted)
    const perDay = days
      .map((d) => `${d.workDate}: ${d.spanHours} hrs → ${driverPayBreakdown(d.pay)} = $${d.pay.total.toLocaleString('en-US')}`)
      .join(' · ')
    const money = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    const verdict =
      Math.abs(delta) < 0.01
        ? 'matches the quoted line'
        : delta > 0
          ? `${money(delta)} more than the quoted ${money(quoted)}`
          : `${money(delta)} less than the quoted ${money(quoted)}`
    out.push({
      ...base, days, actualHours, actualPay, delta,
      summary: `${days.length === 1 ? '1 day' : `${days.length} days`} logged — ${perDay}. Total $${actualPay.toLocaleString('en-US')}, ${verdict}.`,
      applicable: Math.abs(delta) >= 0.01,
      blockedReason: null,
    })
  }
  return out
}

export type ApplyResult =
  | { ok: true; lineId: string; from: number; to: number }
  | { ok: false; error: string; status: number }

/**
 * Put the actual amount on the line. Flat, one period — the hours ARE the
 * quantity now, and the ladder already priced them, so a day count would
 * multiply what is already a total.
 */
export async function applyDriverTrueUp(args: { orderId: string; lineId: string; userId: string | null }): Promise<ApplyResult> {
  const all = await driverTrueUpForOrder(args.orderId)
  const t = all.find((x) => x.lineId === args.lineId)
  if (!t) return { ok: false, status: 404, error: 'That line is not a driver line on this order.' }
  if (t.blockedReason) return { ok: false, status: 409, error: t.blockedReason }
  if (!t.applicable) return { ok: false, status: 409, error: 'The logged hours already match the quoted line.' }

  const line = await prisma.orderLineItem.findUnique({
    where: { id: args.lineId },
    select: { id: true, department: true, rate: true, lineTotal: true, quantity: true, billableDays: true, rateType: true },
  })
  if (!line) return { ok: false, status: 404, error: 'Line not found.' }

  const lineTotal = computeLineTotal({ quantity: 1, rate: t.actualPay, billableDays: 1, rateType: 'FLAT', department: line.department })
  await prisma.orderLineItem.update({
    where: { id: args.lineId },
    data: { rate: t.actualPay, quantity: 1, billableDays: 1, rateType: 'FLAT', lineTotal: round2(lineTotal), usageEstimated: false },
  })
  await recalcOrderTotals(args.orderId)
  await prisma.auditLog.create({
    data: {
      action: 'order.driver_hours_trued_up',
      entityType: 'OrderLineItem',
      entityId: args.lineId,
      userId: args.userId,
      oldValues: { rate: String(line.rate), quantity: line.quantity, billableDays: line.billableDays, rateType: line.rateType, lineTotal: String(line.lineTotal) },
      newValues: { rate: t.actualPay, rateType: 'FLAT', billableDays: 1, lineTotal: round2(lineTotal), actualHours: t.actualHours, days: t.days.map((d) => d.workDate) },
    } as never,
  }).catch(() => {})
  return { ok: true, lineId: args.lineId, from: t.quoted, to: t.actualPay }
}
