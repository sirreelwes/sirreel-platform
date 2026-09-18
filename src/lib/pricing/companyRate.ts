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

/**
 * A standing percentage off, applied to a rate pair.
 *
 * Wes 2026-09-04: "These discounts should be auto applied in all orders
 * from that company going forward."
 *
 * Item-scoped standing discounts land HERE rather than as a discount row
 * because the alternative over-applies: "20% off cube trucks and cargo
 * vans" expressed as a VEHICLES department discount also discounts every
 * honeywagon and talent trailer on the order. Applying it to the rate
 * keeps the deal on exactly the items it was struck on.
 *
 * The consequence for the client's eye is the same one CompanyRate already
 * has: the line prints the reduced rate and no discount row appears. That
 * is the honest rendering — there is no list-price line being reduced,
 * there is a price this client pays for this item.
 *
 * Rounds HALF_UP to cents at the boundary, matching every other money path.
 */
export function applyStandingDiscount(rates: RatePair, percentOff: number): RatePair {
  if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff >= 100) return rates
  const factor = new Prisma.Decimal(100 - percentOff).dividedBy(100)
  const cut = (v: Prisma.Decimal | null): Prisma.Decimal | null => {
    if (v == null || !v.greaterThan(0)) return v
    return v.times(factor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
  }
  return { dailyRate: cut(rates.dailyRate), weeklyRate: cut(rates.weeklyRate) }
}

/**
 * Pick which standing discount governs when several cover the same item.
 * The BEST one wins and they never stack — two overlapping deals mean
 * someone entered the same concession twice, and compounding them would
 * quote a number nobody agreed to.
 */
export function bestStandingDiscount(
  candidates: { id: string; label: string; percentOff: number }[],
): { id: string; label: string; percentOff: number } | null {
  let best: { id: string; label: string; percentOff: number } | null = null
  for (const c of candidates) {
    if (!Number.isFinite(c.percentOff) || c.percentOff <= 0) continue
    if (!best || c.percentOff > best.percentOff) best = c
  }
  return best
}

export interface StandingDiscountRef {
  label: string
  percentOff: number
}

export interface ClientPriceResult extends RatePair {
  /** Where the number came from. LIST means neither deal reached it. */
  source: 'COMPANY_RATE' | 'COMPANY_DISCOUNT' | 'LIST'
  /**
   * True when this client pays something other than list — what the
   * picker reads to strike the list rate through. Both kinds of deal set
   * it: to a rep, "their price" is one idea, not two.
   */
  negotiated: boolean
  /** The standing discount's client-facing label, when one priced this. */
  dealLabel: string | null
}

/**
 * What this client pays for one catalog item — the WHOLE deal in one
 * place.
 *
 * Two different things can price a line for a client and they resolve in
 * a fixed order:
 *
 *   1. CompanyRate (the rate card) overlays the catalog per field.
 *   2. An item-scoped CompanyDiscount takes a percentage off.
 *
 * A rate card row WINS and the standing discount stands down — a
 * negotiated price is already the deal, and taking another 20% off it
 * hands the client the same concession twice with nothing on screen to
 * say where the second one came from. This mirrors resolveRate exactly
 * because resolveRate CALLS this: the number the picker pre-fills and the
 * number the server resolves the line against have to be the same number,
 * or every line for that client saves flagged as a rate override nobody
 * made.
 */
export function clientPrice(
  catalog: RatePair,
  card: RatePair | null,
  standing: StandingDiscountRef | null,
): ClientPriceResult {
  const merged = overlayCompanyRate(catalog, card)
  if (merged.dailyFromCompany || merged.weeklyFromCompany) {
    return {
      dailyRate: merged.dailyRate,
      weeklyRate: merged.weeklyRate,
      source: 'COMPANY_RATE',
      negotiated: true,
      dealLabel: null,
    }
  }
  const base: RatePair = { dailyRate: merged.dailyRate, weeklyRate: merged.weeklyRate }
  if (!standing || !Number.isFinite(standing.percentOff) || standing.percentOff <= 0) {
    return { ...base, source: 'LIST', negotiated: false, dealLabel: null }
  }
  const cut = applyStandingDiscount(base, standing.percentOff)
  // A 100% row (or one that moved nothing, e.g. an unpriced item) is not
  // a price this client "negotiated" — leave the row reading as list
  // rather than striking a list rate through to the same number.
  const moved =
    (cut.dailyRate?.toString() ?? null) !== (base.dailyRate?.toString() ?? null) ||
    (cut.weeklyRate?.toString() ?? null) !== (base.weeklyRate?.toString() ?? null)
  if (!moved) return { ...base, source: 'LIST', negotiated: false, dealLabel: null }
  return { ...cut, source: 'COMPANY_DISCOUNT', negotiated: true, dealLabel: standing.label }
}
