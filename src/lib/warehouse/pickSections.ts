/**
 * Which heading a line prints under on the pull sheet.
 *
 * Wes 2026-09-16, on partner gear the partner drops at our yard: "if they
 * are delivered, they should be on the Pick List but in a different section
 * (Partner). How do we handle this with sub leased equipment? It should be
 * the same as that but under a different heading. Both subbed and partner
 * equipment have to be returned to their host warehouse."
 *
 * So the sheet gains two headings above the departments:
 *
 *   Partner      a partner's ROSTER unit, delivered to Lankershim
 *                (DELIVER_TO_SIRREEL — the only receive method whose gear
 *                reaches our floor; see partnerLines.ts)
 *   Sub-Rental   ad-hoc gear sub-leased from another house ("Sub-rent…" on a
 *                line). These were always on the sheet — but scattered
 *                through the department sections, indistinguishable from
 *                gear SirReel owns.
 *
 * WHY THE SEPARATION EARNS ITS KEEP: this is borrowed gear on somebody
 * else's asset register. It has to go back to the house it came from, and on
 * the old sheet nothing said so — a sub-leased fixture came back, got
 * counted in, and sat on our shelf looking like ours. Grouping them and
 * NAMING the host is the whole point; the heading without the name would
 * just be tidier filing.
 *
 * PURE, no Prisma: renderPickListPdf resolves the rows, this decides the
 * heading, and the test holds both without a database.
 */

import { LINE_ITEM_DEPARTMENT_ORDER } from '@/lib/orders/lineItemDepartments'

/** The two borrowed-gear headings, above the owned-gear departments. */
export type PickSectionKey = 'PARTNER' | 'SUB_RENTAL'

export const PICK_SECTION_LABEL: Record<PickSectionKey, string> = {
  PARTNER: 'Partner',
  SUB_RENTAL: 'Sub-Rental',
}

/** What the grouper keys on: a borrowed-gear heading, or a department. */
export type PickGroupKey = PickSectionKey | string

/** The minimum a caller has to resolve for a line. */
export interface PickSectionFacts {
  /** Live sub-rentals on this line (or on the line it rides under). */
  subRentals: { subcontractedVehicleId: string | null; vendorName: string | null }[]
}

/**
 * PARTNER when a roster unit fulfils the line, SUB_RENTAL when an ad-hoc
 * sub-lease does, null when it is our own gear.
 *
 * A line carrying both is PARTNER: a roster unit is the more specific fact,
 * and a partner booking is the one with a portal, an agreement and a deal
 * behind it.
 */
export function pickSectionFor(facts: PickSectionFacts): PickSectionKey | null {
  if (facts.subRentals.length === 0) return null
  return facts.subRentals.some((s) => s.subcontractedVehicleId) ? 'PARTNER' : 'SUB_RENTAL'
}

/**
 * "Back to PowerTrip Rentals" — printed under the line so the floor knows
 * the gear is on loan before it is counted back onto our own shelf.
 * Several vendors on one line are named in order; none is null.
 */
export function returnToLabel(facts: PickSectionFacts): string | null {
  const names = Array.from(new Set(facts.subRentals.map((s) => s.vendorName).filter((n): n is string => !!n)))
  if (names.length === 0) return null
  return `Back to ${names.join(' · ')}`
}

/**
 * Borrowed gear FIRST, then the departments in their usual order.
 *
 * First because it is the part of the pull that is not routine: it is
 * somebody else's property, it may not be on the shelf yet when the picker
 * starts, and a partner delivery that has not arrived is the thing worth
 * discovering at the top of the sheet rather than the bottom.
 */
export const PICK_GROUP_ORDER: readonly PickGroupKey[] = [
  'PARTNER',
  'SUB_RENTAL',
  ...LINE_ITEM_DEPARTMENT_ORDER,
]

export function pickGroupLabel(key: PickGroupKey, departmentLabel: (k: string) => string): string {
  return key in PICK_SECTION_LABEL ? PICK_SECTION_LABEL[key as PickSectionKey] : departmentLabel(key)
}

export function isPickSection(key: PickGroupKey): key is PickSectionKey {
  return key in PICK_SECTION_LABEL
}
