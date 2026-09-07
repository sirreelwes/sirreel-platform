/**
 * Partner "specialty" units bill straight daily — never the weekly cap.
 *
 * Wes 2026-09-07: "none of the partner vehicles in this class (motorhome,
 * restroom trailers — what we call Specialty Vehicles) fees can be reduced
 * to 1d 2d 3d week etc. These are daily fees."
 *
 * A partner-fulfilled line (a SubRental hangs off it) and every fee that
 * rides under it (driver, mileage, supplies, generator) are the partner's
 * money at the partner's day rate; SirReel's 5-day vehicle week is not
 * ours to give away on them. So: no week-cap chips, no cap on a date push,
 * no bulk "set all" days — billable days are calendar days.
 *
 * Detection is structural (the SubRental relation, or the parent's), not a
 * name match, so a partner cube truck is exempt too and a SirReel-owned
 * motorhome is not.
 */

export interface PartnerDailyLine {
  id: string
  parentLineItemId?: string | null
  subRentals?: { id: string }[] | null
}

/** True when this line, or the line it rides under, is fulfilled by a partner's unit. */
export function isPartnerFulfilled(line: PartnerDailyLine, lines: PartnerDailyLine[]): boolean {
  if ((line.subRentals?.length ?? 0) > 0) return true
  if (!line.parentLineItemId) return false
  const parent = lines.find((l) => l.id === line.parentLineItemId)
  return !!parent && (parent.subRentals?.length ?? 0) > 0
}

export const PARTNER_DAILY_NOTE = 'Partner unit — billed per day, no weekly cap.'
