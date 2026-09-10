/**
 * SPECIALTY VEHICLES — the class, made answerable from a line.
 *
 * Wes 2026-09-10: "motorhomes and wardrobe makeup trailers are all going
 * to be in the Specialty Vehicles category," and the category is a
 * BILLING class, not a shelf label. The signed rental agreement has said
 * so since launch (portal-v2/terms.ts, LCDW_ELIGIBILITY_NOTE): specialty
 * vehicles carry no LCDW. The quote's mileage term says they bill per
 * mile from the first mile. Wes 2026-09-07 said their days never reduce
 * to a week rate.
 *
 * Three rules, and until now three different tests for the same word:
 *
 *   • LCDW asked "is the catalog code on a hand-kept list?"
 *   • The mileage term asked "does this line have a SubRental?"
 *   • The week cap asked the same SubRental question, through
 *     `isPartnerFulfilled`, spelled out inline in seven other files.
 *
 * None of them could see an OWNED specialty vehicle. The 2 Unit Restroom
 * Trailer is ours — four units, on the gantt, no SubRental — so it was
 * excluded from LCDW (it made the code list) while still being offered
 * the standard mileage allowance on its own quote and still collapsing a
 * 7-day rental to a 5-day week. This module is the one answer all three
 * read.
 *
 * ── The three tests, in order of authority ─────────────────────────
 *
 *   1. THE CATALOG FLAG (`InventoryItem.isSpecialtyVehicle`). Stable
 *      across renames, and the only one an operator can change without
 *      a deploy. This is the rule; the other two are nets under it.
 *   2. PARTNER-FULFILLED (a SubRental on the line or its parent). A
 *      partner's coach is specialty whether or not anyone catalogued
 *      it, and it is how every motorhome reaches an order today.
 *   3. THE NAME. Only for a line with NO catalog row — a rep typing
 *      "Wardrobe Trailer" against nothing. Five of the trailer
 *      categories exist as marketing rows with no catalog item and no
 *      fleet units behind them, so a quote for one is a typed line by
 *      definition.
 *
 * All three can only ever ADD to the class, never remove from it. A
 * false positive costs a waiver we decline to sell and bills a day we
 * would otherwise discount; a false negative sells coverage that does
 * not exist and under-bills a partner's unit. The contract wins.
 *
 * ── Why the cutover date ───────────────────────────────────────────
 *
 * Rule 1 is NEW money on owned units: a restroom trailer that used to
 * take the weekly cap now bills calendar days. Per the house rule (Wes
 * 2026-09-07, rate changes never touch past money), the week-cap
 * consumers pass the LINE's createdAt and lines written before the
 * cutover keep the billing they were quoted at. Rules 2 and 3 are not
 * gated — they describe what the line always was.
 */

/** The shape every caller can produce from its own select. */
export interface SpecialtyLine {
  id: string
  description?: string | null
  /** Set when this line rides under another (a driver, a mileage fee). */
  parentLineItemId?: string | null
  /** Non-empty when a partner's unit fulfills this line. */
  subRentals?: { id: string }[] | null
  /** `InventoryItem.isSpecialtyVehicle` for the line's catalog row. */
  catalogIsSpecialty?: boolean | null
  /** Catalog code, when the line matched one. Absence is what opens
   *  the name test — see rule 3. */
  code?: string | null
}

/**
 * Names the agreement's specialty class covers that have no catalog row
 * to flag. Kept narrow and specific: each pattern names a vehicle
 * SirReel does not own and has never held on the gantt.
 *
 * Restroom trailers and lifts are deliberately ABSENT — they are
 * catalogued (CAT_DLUX, CAT_DLUX_NORCAL, CAT_SCISSOR_LIFT), so the flag
 * answers for them and a second, looser test would only add ways to be
 * wrong. LCDW keeps its own name list for its own older reasons; this
 * one exists for the trailer families.
 */
const SPECIALTY_NAME_PATTERNS: readonly RegExp[] = [
  /\bmotor\s*home\b/i,
  /\bmotorhome\b/i,
  /\bstar\s*wagon\b/i,
  /\bhoney\s*wagon\b/i,
  /\btalent\s*trailer\b/i,
  /\bwardrobe\s*trailer\b/i,
  /\bhair\b.{0,8}\bmakeup\b/i,
  /\bmake\s*up\s*trailer\b/i,
  /\bproduction\s*trailer\b/i,
  /\blocation\s*trailer\b/i,
]

/** Does a free-typed description name a specialty vehicle? */
export function matchesSpecialtyName(description: string | null | undefined): boolean {
  if (!description) return false
  return SPECIALTY_NAME_PATTERNS.some((re) => re.test(description))
}

/**
 * Rule 2 on its own — a partner's unit fulfills this line, or the line
 * it rides under. Exported because "the partner's money" is a real
 * question of its own (it decides whose rate a fee is at), separate
 * from "is this a specialty vehicle".
 */
export function isPartnerFulfilledLine(line: SpecialtyLine, lines: SpecialtyLine[]): boolean {
  if ((line.subRentals?.length ?? 0) > 0) return true
  if (!line.parentLineItemId) return false
  const parent = lines.find((l) => l.id === line.parentLineItemId)
  return !!parent && (parent.subRentals?.length ?? 0) > 0
}

/**
 * The class. `lines` is the order's line list, needed only to follow a
 * fee back to the vehicle it rides under.
 */
export function isSpecialtyVehicleLine(line: SpecialtyLine, lines: SpecialtyLine[]): boolean {
  if (line.catalogIsSpecialty) return true
  if (isPartnerFulfilledLine(line, lines)) return true
  if (!line.code && matchesSpecialtyName(line.description)) return true
  return false
}

/**
 * The day the catalog flag started deciding money. Lines written before
 * it keep the billing they were quoted at — a client who was quoted a
 * 5-day week on a restroom trailer in August is not re-billed because
 * the rule changed in September.
 */
export const SPECIALTY_CATALOG_RULE_FROM = new Date('2026-09-10T00:00:00.000Z')

/**
 * Billing-facing variant: does this line bill as a specialty vehicle
 * (calendar days, no weekly cap)?
 *
 * `createdAt` is the LINE's, not the order's. Omit it only on display
 * surfaces that describe the class rather than price it.
 */
export function billsAsSpecialtyVehicle(
  line: SpecialtyLine & { createdAt?: Date | string | null },
  lines: SpecialtyLine[],
): boolean {
  // Rules 2 and 3 describe what the line always was — never gated.
  if (isPartnerFulfilledLine(line, lines)) return true
  if (!line.code && matchesSpecialtyName(line.description)) return true
  if (!line.catalogIsSpecialty) return false
  // Rule 1 is new money. A line with no createdAt is being priced now.
  if (!line.createdAt) return true
  const created = line.createdAt instanceof Date ? line.createdAt : new Date(line.createdAt)
  return !Number.isNaN(created.getTime()) && created >= SPECIALTY_CATALOG_RULE_FROM
}

/**
 * Adapter from a Prisma OrderLineItem row. Every caller selects the same
 * four things — `subRentals`, `parentLineItemId`, the catalog row's
 * `code` + `isSpecialtyVehicle`, and `createdAt` — so the mapping lives
 * here rather than being retyped (and mistyped) at each site.
 */
export function specialtyShape(l: {
  id: string
  description?: string | null
  parentLineItemId?: string | null
  subRentals?: { id: string }[] | null
  createdAt?: Date | null
  inventoryItem?: { code?: string | null; isSpecialtyVehicle?: boolean } | null
}): SpecialtyLine & { createdAt?: Date | null } {
  return {
    id: l.id,
    description: l.description ?? null,
    parentLineItemId: l.parentLineItemId ?? null,
    subRentals: l.subRentals ?? null,
    code: l.inventoryItem?.code ?? null,
    catalogIsSpecialty: l.inventoryItem?.isSpecialtyVehicle ?? false,
    createdAt: l.createdAt ?? null,
  }
}

export const SPECIALTY_DAILY_NOTE = 'Specialty Vehicle — billed per day, no weekly cap.'
