/**
 * The client rate card — pure half.
 *
 * A CompanyRate is a NEGOTIATED PRICE, not a discount. The difference is
 * what the client reads on the quote:
 *
 *   OrderDiscount  → the line still prints $170.00/day and a "Vehicles
 *                    discount" row appears under the section subtotal.
 *   CompanyRate    → the line prints $130.00/day. No discount row.
 *
 * Everything here is deliberately Prisma-client-free so the rules can be
 * unit-tested without a database (`npm run test:company-rate`); the
 * lookup lives in resolveRate.ts.
 */

import { Prisma } from '@prisma/client'

export interface RatePair {
  dailyRate: Prisma.Decimal | null
  weeklyRate: Prisma.Decimal | null
}

/**
 * A negotiated value only counts when it is POSITIVE. Zero and null both
 * mean "not negotiated for this field" — never "free" — which matches the
 * catalog's own `rate <= 0 = unpriced` rule. Without this, an empty rate
 * box saved as 0 would silently quote the client a $0/day van.
 */
export function negotiated(v: Prisma.Decimal | null | undefined): Prisma.Decimal | null {
  return v != null && v.greaterThan(0) ? v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null
}

export interface OverlayResult extends RatePair {
  /** True when the daily figure came from the client's rate card. */
  dailyFromCompany: boolean
  /** True when the weekly figure came from the client's rate card. */
  weeklyFromCompany: boolean
}

/**
 * Overlay a client's negotiated rates onto the catalog rates, PER FIELD.
 *
 * Per-field is the point: deals are usually struck on the daily and left
 * silent on the weekly. Replacing the whole pair would blank the weekly
 * rate for that client, and a weekly-billed line would fall through to
 * "unpriced" — a $0 line on a real quote.
 */
export function overlayCompanyRate(catalog: RatePair, company: RatePair | null): OverlayResult {
  const cd = negotiated(company?.dailyRate)
  const cw = negotiated(company?.weeklyRate)
  return {
    dailyRate: cd ?? catalog.dailyRate,
    weeklyRate: cw ?? catalog.weeklyRate,
    dailyFromCompany: cd != null,
    weeklyFromCompany: cw != null,
  }
}
