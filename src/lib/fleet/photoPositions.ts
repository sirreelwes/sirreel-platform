/**
 * The guided walk-around — the fixed set of shots a tech takes at BOTH
 * ends of a rental.
 *
 * Wes, 2026-09-02: emulate the DamageID check-out/check-in process
 * rather than invent one. DamageID's whole mechanism is that the same
 * angles are photographed every time, both directions, against the same
 * booking, so the two sets can be laid side by side when someone
 * disputes a dent. A free-form "take some photos" button cannot do
 * that: if nobody shot the passenger side on the way out, the passenger
 * side on the way back proves nothing.
 *
 * So this list is the contract between the two screens. Check-out fills
 * the slots; check-in shows each check-out photo directly above the
 * button that replaces it. Changing the list changes what a comparison
 * means, so it lives in one place and both forms import it.
 *
 * Stored as a plain string on InspectionPhoto.position — see the schema
 * note for why this is not an enum.
 */

export interface PhotoPosition {
  /** Stored value. Never rename one of these — old photos keep it. */
  id: string
  /** What the tech reads on the button. */
  label: string
  /** The one-line instruction under it. Concrete beats exhaustive. */
  hint: string
}

/**
 * The seven required slots, in walk-around order — you circle the
 * vehicle, then get in. Odometer and fuel are shots rather than only
 * typed numbers because a photo of the gauge is what settles an
 * argument about the number.
 */
export const REQUIRED_POSITIONS: readonly PhotoPosition[] = [
  { id: 'FRONT',          label: 'Front',          hint: 'Straight on, whole front end in frame' },
  { id: 'DRIVER_SIDE',    label: 'Driver side',    hint: 'Full length of the driver side' },
  { id: 'REAR',           label: 'Rear',           hint: 'Straight on, including the liftgate or roll-up' },
  { id: 'PASSENGER_SIDE', label: 'Passenger side', hint: 'Full length of the passenger side' },
  { id: 'INTERIOR',       label: 'Interior',       hint: 'Cab and cargo area' },
  { id: 'ODOMETER',       label: 'Odometer',       hint: 'Close enough to read the number' },
  { id: 'FUEL_GAUGE',     label: 'Fuel gauge',     hint: 'Needle clearly visible' },
] as const

/** Close-ups of specific damage. Unlimited, and never required. */
export const DAMAGE_POSITION = 'DAMAGE'

/** Anything shot before the guided capture existed, or an extra. */
export const OTHER_LABEL = 'Other'

const BY_ID = new Map(REQUIRED_POSITIONS.map((p) => [p.id, p]))

export function positionLabel(position: string | null | undefined): string {
  if (!position) return OTHER_LABEL
  if (position === DAMAGE_POSITION) return 'Damage close-up'
  return BY_ID.get(position)?.label ?? position
}

/** Guards the stored value — anything unrecognised is dropped to null
 *  rather than written through, so the column stays readable. */
export function normalizePosition(position: unknown): string | null {
  if (typeof position !== 'string') return null
  if (position === DAMAGE_POSITION) return position
  return BY_ID.has(position) ? position : null
}

/** Which required slots have no photo yet. Drives the "3 of 7" counter
 *  and the soft warning on submit — soft because a tech standing in
 *  front of a truck at 6am must never be locked out of recording what
 *  they can see. */
export function missingPositions(taken: Iterable<string | null | undefined>): PhotoPosition[] {
  const have = new Set([...taken].filter(Boolean) as string[])
  return REQUIRED_POSITIONS.filter((p) => !have.has(p.id))
}
