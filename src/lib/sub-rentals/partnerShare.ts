/**
 * THE DEAL between SirReel and a vehicle partner, in one place.
 *
 * Wes 2026-09-06 (King Kong): "my deal with david is 20% of vehicle rental
 * rate goes to sirreel. that needs to be on this page and integrated into
 * billing and communications."
 *
 *   production pays   = the partner's LISTED rate (what we quote)
 *   SirReel keeps     = list × share/100            (Vendor.partnerSharePercent)
 *   partner receives  = list × (1 − share/100)      (what we owe them)
 *
 * SubcontractedVehicle.discountPercent predates the vendor-level deal and
 * stays as a per-unit OVERRIDE; null there means "the vendor's deal". Every
 * reader goes through effectiveSharePercent so a unit never silently quotes
 * a different split than the one on the partner's page.
 *
 * stampVendorCost is the billing hook: when a sub-rental becomes real
 * (client accepts → REQUESTED; partner confirms; order books) it writes the
 * vendor-side rate and total onto the row — only into NULL fields, so a
 * number a human typed (a one-off negotiated price) is never overwritten.
 */
import { prisma } from '@/lib/prisma'
import { partnerMarginsForOrder } from '@/lib/sub-rentals/partnerMargins'

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Unit override first, then the vendor's standing deal. */
export function effectiveSharePercent(
  unit: { discountPercent: unknown } | null | undefined,
  vendor: { partnerSharePercent: unknown } | null | undefined,
): number | null {
  return num(unit?.discountPercent) ?? num(vendor?.partnerSharePercent)
}

/** What the partner receives: list × (1 − share/100), to the cent. */
export function partnerNet(list: unknown, sharePercent: number | null): number | null {
  const l = num(list)
  if (l == null || sharePercent == null) return null
  return Math.round(l * (1 - sharePercent / 100) * 100) / 100
}

/** Inclusive calendar days of a @db.Date window. */
export function rentalDays(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null
  const d = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  return d >= 1 ? d : null
}

/** Weekly blocks where a weekly rate exists, daily for the remainder. */
export function costForWindow(rates: { daily: number | null; weekly: number | null }, days: number | null, quantity = 1): number | null {
  if (days == null || rates.daily == null) return null
  let total: number
  if (rates.weekly != null && days >= 7) {
    const weeks = Math.floor(days / 7)
    const rem = days % 7
    total = weeks * rates.weekly + Math.min(rem * rates.daily, rates.weekly)
  } else total = days * rates.daily
  return Math.round(total * quantity * 100) / 100
}

export interface StampedCost {
  /** SirReel's share of list as actually applied to this booking: the deal,
   *  plus the partner's part of any client discount. */
  sharePercent: number
  listDaily: number | null
  vendorDaily: number | null
  vendorTotal: number | null
  /** Points of list the partner gave to keep this client (discountWaterfall). */
  concessionPercent: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Write the vendor-side money onto a sub-rental. Null fields only; returns
 * what is now on the row (for the email that follows), or null when there is
 * no deal or no list rate to apply.
 *
 * On an order line the partner is paid what the discount waterfall says —
 * their deal, less their share of any client discount — for the days the
 * LINE bills. Partner units bill calendar days, never a weekly block
 * (partnerDaily.ts); stamping weekly blocks here told a partner $9,428 for a
 * ten-day booking the client paid daily for.
 *
 * The list rate comes from the partner's roster unit only. It used to fall
 * back to the booking's clientDailyRate — the CLIENT's price, discounts and
 * all — so the partner's pay moved with our client deals and their notice
 * quoted that price as their "list".
 */
export async function stampVendorCost(subRentalId: string): Promise<StampedCost | null> {
  const s = await prisma.subRental.findUnique({
    where: { id: subRentalId },
    select: {
      quantity: true, startDate: true, endDate: true, orderId: true, orderLineItemId: true,
      vendorDailyRate: true, vendorTotal: true, clientDailyRate: true, clientTotal: true,
      subcontractedVehicle: { select: { listDailyRate: true, discountPercent: true } },
      vendor: { select: { partnerSharePercent: true } },
    },
  })
  if (!s) return null
  const share = effectiveSharePercent(s.subcontractedVehicle, s.vendor)
  const listDaily = num(s.subcontractedVehicle?.listDailyRate)
  if (share == null || listDaily == null) return null

  const margin = s.orderId && s.orderLineItemId
    ? (await partnerMarginsForOrder(s.orderId)).find((m) => m.subRentalId === subRentalId) ?? null
    : null
  let vendorDaily: number | null
  let vendorTotal: number | null
  let clientTotal: number | null
  let concessionPercent = 0
  if (margin?.waterfall && margin.partnerPay != null) {
    vendorDaily = round2(margin.partnerPay / margin.units)
    vendorTotal = round2(margin.partnerPay)
    clientTotal = margin.waterfall.billed
    if (!margin.committed) concessionPercent = margin.waterfall.concessionPercent
  } else {
    // Not on a line yet (a quoted unit hanging off the job): the deal on
    // list, calendar days.
    const days = rentalDays(s.startDate, s.endDate)
    vendorDaily = partnerNet(listDaily, share)
    vendorTotal = costForWindow({ daily: vendorDaily, weekly: null }, days, s.quantity)
    clientTotal = costForWindow({ daily: listDaily, weekly: null }, days, s.quantity)
  }
  await prisma.subRental.update({
    where: { id: subRentalId },
    data: {
      ...(s.vendorDailyRate == null && vendorDaily != null ? { vendorDailyRate: vendorDaily } : {}),
      ...(s.vendorTotal == null && vendorTotal != null ? { vendorTotal } : {}),
      ...(s.clientDailyRate == null ? { clientDailyRate: listDaily } : {}),
      ...(s.clientTotal == null && clientTotal != null ? { clientTotal } : {}),
    },
  })
  const onRowDaily = num(s.vendorDailyRate) ?? vendorDaily
  return {
    // Read back off what the partner is actually paid, so a hand-typed rate
    // is described truthfully in the notice.
    sharePercent: onRowDaily != null ? round2((1 - onRowDaily / listDaily) * 100) : share,
    listDaily,
    vendorDaily: onRowDaily,
    vendorTotal: num(s.vendorTotal) ?? vendorTotal,
    concessionPercent: s.vendorDailyRate == null ? concessionPercent : 0,
  }
}
