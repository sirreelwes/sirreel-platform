/**
 * Partner ancillary fees → order lines.
 *
 * SubcontractedFee's own comment called this gap: "Sales needs these at quote
 * time; without them a King Kong quote is short by the majority of a real
 * day's cost." It was right — S260828-001 went out at $2,345 with the driver,
 * mileage, generator and supplies charges missing entirely, because the fees
 * were only ever read by the estimate EMAIL and no path carried them onto an
 * order. This is that path.
 *
 * ── Two kinds of fee, priced differently ────────────────────────────────────
 * PER_DAY (driver, supplies) is knowable at quote time: the order already has
 * a day count, so the line is a normal DAILY line and nothing is estimated.
 *
 * PER_MILE / PER_HOUR / PER_GALLON (mileage, generator hours) is NOT knowable
 * — nobody knows the mileage until the coach comes back. RateType has no
 * per-mile or per-hour member and inventing one would ripple through every
 * total in the app, so these become FLAT lines whose QUANTITY is the rep's
 * estimated usage and whose rate is the per-unit price. Wes 2026-08-28: the
 * rep estimates, and the quote says so — hence `usageEstimated` plus the
 * client-facing note, which prints under the description on the quote PDF.
 *
 * ── The money rule still holds ──────────────────────────────────────────────
 * Fees are added at the vendor's LIST `amount`. `discountApplies` changes what
 * WE pay, never what the client is quoted — the same rule estimateEmail.ts
 * follows. This module does not read `discountApplies` or any net cost, so a
 * margin cannot leak into a client document through here.
 */
import { prisma } from '@/lib/prisma'
import type { FeeUnit, Prisma } from '@prisma/client'

/** The wording the client reads under an estimated line, on every surface. */
export const ESTIMATE_NOTE = 'Estimate only — actual usage will be invoiced.'

/**
 * Billing PERIODS on a flat/metered line — one, always.
 *
 * Not cosmetic. computeLineTotal() multiplies quantity × rate × billableDays
 * for every department except EXPENDABLES, and returns a hard 0 when
 * billableDays is null (that null means "dates TBD", a different thing). A
 * metered line left at null therefore priced at $0 while its own lineTotal
 * column said $354 — the order total and the line disagreed. One period is
 * the honest value: the quantity carries the miles or hours, and the charge
 * must NOT scale with the length of the rental the way a day rate does.
 */
const FLAT_PERIODS = 1

/** Units whose quantity nobody can know until after the job. */
const METERED: FeeUnit[] = ['PER_MILE', 'PER_HOUR', 'PER_GALLON']

export function isMetered(unit: FeeUnit): boolean {
  return METERED.includes(unit)
}

/** How a metered fee's quantity is labelled to the rep and in the note. */
export function usageNoun(unit: FeeUnit): string {
  switch (unit) {
    case 'PER_MILE': return 'miles'
    case 'PER_HOUR': return 'hours'
    case 'PER_GALLON': return 'gallons'
    default: return 'units'
  }
}

export interface PartnerFee {
  id: string
  label: string
  amount: string
  unit: FeeUnit
  coversHours: string | null
  unionScope: string
  metered: boolean
  usageNoun: string
}

/**
 * A vehicle's effective fee schedule: the vendor's standing fees unioned with
 * anything specific to this unit, the unit's version winning a same-label
 * collision. Exactly the rule SubcontractedFee's comment states, and the same
 * one the estimate email applies — they must agree, or the quote would differ
 * from the estimate the client already read.
 */
export async function partnerFeeSchedule(vehicleId: string): Promise<{
  vehicleName: string
  fees: PartnerFee[]
} | null> {
  const vehicle = await prisma.subcontractedVehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, name: true, vendorId: true },
  })
  if (!vehicle) return null

  const rows = await prisma.subcontractedFee.findMany({
    where: {
      isActive: true,
      vendorId: vehicle.vendorId,
      OR: [{ vehicleId: null }, { vehicleId: vehicle.id }],
    },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    select: {
      id: true, label: true, amount: true, unit: true,
      coversHours: true, unionScope: true, vehicleId: true,
    },
  })

  const byLabel = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    const key = r.label.trim().toLowerCase()
    const seen = byLabel.get(key)
    // Unit-specific wins; otherwise first-seen (sortOrder) wins.
    if (!seen || (!seen.vehicleId && r.vehicleId)) byLabel.set(key, r)
  }

  return {
    vehicleName: vehicle.name,
    fees: [...byLabel.values()].map((r) => ({
      id: r.id,
      label: r.label,
      amount: r.amount.toString(),
      unit: r.unit,
      coversHours: r.coversHours?.toString() ?? null,
      unionScope: r.unionScope,
      metered: isMetered(r.unit),
      usageNoun: usageNoun(r.unit),
    })),
  }
}

/** What the rep submitted: fee id → estimated usage (metered fees only). */
export type FeeEstimates = Record<string, number>

export interface BuiltFeeLine {
  description: string
  rate: Prisma.Decimal
  rateType: 'DAILY' | 'FLAT'
  quantity: number
  billableDays: number | null
  notes: string | null
  usageEstimated: boolean
  lineTotal: Prisma.Decimal
}

/**
 * Shape the lines without writing them, so the API can preview and the caller
 * can total them before anything is persisted.
 *
 * `days` is the order's billable day count, used for PER_DAY fees. A metered
 * fee with no estimate (or zero) is SKIPPED rather than added at zero: a $0
 * line on a quote reads as "included", which is the opposite of what it means.
 */
export function buildFeeLines(
  fees: PartnerFee[],
  estimates: FeeEstimates,
  days: number,
  Decimal: typeof Prisma.Decimal,
): BuiltFeeLine[] {
  const out: BuiltFeeLine[] = []

  for (const fee of fees) {
    const amount = new Decimal(fee.amount)

    if (fee.unit === 'PER_DAY') {
      const covers = fee.coversHours ? ` (covers ${Number(fee.coversHours)} hrs)` : ''
      out.push({
        description: `${fee.label}${covers}`,
        rate: amount,
        rateType: 'DAILY',
        quantity: 1,
        billableDays: days,
        notes: null,
        usageEstimated: false,
        lineTotal: amount.mul(days),
      })
      continue
    }

    if (fee.unit === 'FLAT') {
      out.push({
        description: fee.label,
        rate: amount,
        rateType: 'FLAT',
        quantity: 1,
        billableDays: FLAT_PERIODS,
        notes: null,
        usageEstimated: false,
        lineTotal: amount,
      })
      continue
    }

    if (fee.metered) {
      const qty = Math.max(0, Math.round(Number(estimates[fee.id] ?? 0)))
      if (!qty) continue
      out.push({
        description: `${fee.label} (per ${fee.usageNoun.replace(/s$/, '')})`,
        rate: amount,
        rateType: 'FLAT',
        quantity: qty,
        billableDays: FLAT_PERIODS,
        notes: `Estimated ${qty} ${fee.usageNoun} at $${fee.amount} per ${fee.usageNoun.replace(/s$/, '')}. ${ESTIMATE_NOTE}`,
        usageEstimated: true,
        lineTotal: amount.mul(qty),
      })
      continue
    }

    // PERCENT has no base to apply to in a partner schedule — it never
    // appears in one today, and guessing a base would invent money.
  }

  return out
}
