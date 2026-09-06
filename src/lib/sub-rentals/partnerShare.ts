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
  sharePercent: number
  listDaily: number | null
  vendorDaily: number | null
  vendorTotal: number | null
}

/**
 * Write the vendor-side money onto a sub-rental from its unit's list rates
 * and the effective share. Null fields only; returns what is now on the row
 * (for the email that follows), or null when there is no deal to apply.
 */
export async function stampVendorCost(subRentalId: string): Promise<StampedCost | null> {
  const s = await prisma.subRental.findUnique({
    where: { id: subRentalId },
    select: {
      quantity: true, startDate: true, endDate: true,
      vendorDailyRate: true, vendorWeeklyRate: true, vendorTotal: true, clientDailyRate: true, clientWeeklyRate: true, clientTotal: true,
      subcontractedVehicle: { select: { listDailyRate: true, listWeeklyRate: true, discountPercent: true } },
      vendor: { select: { partnerSharePercent: true } },
    },
  })
  if (!s) return null
  const share = effectiveSharePercent(s.subcontractedVehicle, s.vendor)
  if (share == null) return null
  const listDaily = num(s.subcontractedVehicle?.listDailyRate) ?? num(s.clientDailyRate)
  const listWeekly = num(s.subcontractedVehicle?.listWeeklyRate) ?? num(s.clientWeeklyRate)
  const vendorDaily = num(s.vendorDailyRate) ?? partnerNet(listDaily, share)
  const vendorWeekly = num(s.vendorWeeklyRate) ?? partnerNet(listWeekly, share)
  const days = rentalDays(s.startDate, s.endDate)
  const vendorTotal = num(s.vendorTotal) ?? costForWindow({ daily: vendorDaily, weekly: vendorWeekly }, days, s.quantity)
  const clientTotal = num(s.clientTotal) ?? costForWindow({ daily: listDaily, weekly: listWeekly }, days, s.quantity)
  await prisma.subRental.update({
    where: { id: subRentalId },
    data: {
      ...(s.vendorDailyRate == null && vendorDaily != null ? { vendorDailyRate: vendorDaily } : {}),
      ...(s.vendorWeeklyRate == null && vendorWeekly != null ? { vendorWeeklyRate: vendorWeekly } : {}),
      ...(s.vendorTotal == null && vendorTotal != null ? { vendorTotal } : {}),
      ...(s.clientDailyRate == null && listDaily != null ? { clientDailyRate: listDaily } : {}),
      ...(s.clientTotal == null && clientTotal != null ? { clientTotal } : {}),
    },
  })
  return { sharePercent: share, listDaily, vendorDaily, vendorTotal }
}
