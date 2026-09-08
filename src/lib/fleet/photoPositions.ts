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
  /** Section heading in the capture UI. At 22 slots an undifferentiated
   *  column is a wall; grouped, it reads as "walk the sides, then the
   *  wheels, then get in", which is the order the tech moves anyway. */
  group: PhotoGroup
}

export type PhotoGroup = 'Sides & corners' | 'Wheels' | 'Detail' | 'Interior' | 'Gauges'

/** Section order for the capture screen. */
export const PHOTO_GROUPS: readonly PhotoGroup[] = [
  'Sides & corners', 'Wheels', 'Detail', 'Interior', 'Gauges',
] as const

/**
 * The required slots, in walk-around order — you circle the vehicle,
 * then get in. Odometer and fuel are shots rather than only typed
 * numbers because a photo of the gauge is what settles an argument
 * about the number.
 *
 * Went from 7 to 22 on 2026-09-08. Hugo's complaint was simply that
 * seven was not enough to defend a damage claim — DamageID asks for
 * about 22 at each end, and the four flat sides miss exactly what gets
 * hit: corners, bumpers, wheels and the lift gate. The count is the
 * point, so the additions are the angles a body shop argues about.
 *
 * The first seven ids are UNCHANGED and in their original order. Old
 * photos carry these strings, the driver self-serve subsets pick from
 * them by id, and a rename would orphan both.
 *
 * A truck that checked out under the old seven will show fifteen slots
 * at check-in with nothing above them to compare against. That is
 * expected and the capture screen says so per slot rather than leaving
 * a gap the tech has to interpret.
 */
export const REQUIRED_POSITIONS: readonly PhotoPosition[] = [
  // The original four flat sides, ids and order untouched.
  { id: 'FRONT',          label: 'Front',          hint: 'Straight on, whole front end in frame', group: 'Sides & corners' },
  { id: 'DRIVER_SIDE',    label: 'Driver side',    hint: 'Full length of the driver side', group: 'Sides & corners' },
  { id: 'REAR',           label: 'Rear',           hint: 'Straight on, including the liftgate or roll-up', group: 'Sides & corners' },
  { id: 'PASSENGER_SIDE', label: 'Passenger side', hint: 'Full length of the passenger side', group: 'Sides & corners' },
  // The corners. A flat side photo flattens the very panel edges that
  // get clipped backing out of a location; a 3/4 shows both faces.
  { id: 'FRONT_DRIVER_CORNER',     label: 'Front driver corner',     hint: 'Three-quarter angle — front and driver side in one frame', group: 'Sides & corners' },
  { id: 'REAR_DRIVER_CORNER',      label: 'Rear driver corner',      hint: 'Three-quarter angle — driver side and rear', group: 'Sides & corners' },
  { id: 'REAR_PASSENGER_CORNER',   label: 'Rear passenger corner',   hint: 'Three-quarter angle — rear and passenger side', group: 'Sides & corners' },
  { id: 'FRONT_PASSENGER_CORNER',  label: 'Front passenger corner',  hint: 'Three-quarter angle — passenger side and front', group: 'Sides & corners' },

  // Curbing a wheel is the single most common return damage and the
  // side shots never show the rim face.
  { id: 'WHEEL_DRIVER_FRONT',     label: 'Driver front wheel',     hint: 'Rim face and sidewall', group: 'Wheels' },
  { id: 'WHEEL_DRIVER_REAR',      label: 'Driver rear wheel',      hint: 'Rim face and sidewall', group: 'Wheels' },
  { id: 'WHEEL_PASSENGER_REAR',   label: 'Passenger rear wheel',   hint: 'Rim face and sidewall', group: 'Wheels' },
  { id: 'WHEEL_PASSENGER_FRONT',  label: 'Passenger front wheel',  hint: 'Rim face and sidewall', group: 'Wheels' },

  { id: 'ROOF',          label: 'Roof / top',           hint: 'From the mirror or a step — scrapes from low clearances live here', group: 'Detail' },
  { id: 'WINDSHIELD',    label: 'Windshield',           hint: 'Whole glass, angled so chips show', group: 'Detail' },
  { id: 'FRONT_BUMPER',  label: 'Front bumper',         hint: 'Low and close, full width', group: 'Detail' },
  { id: 'REAR_BUMPER',   label: 'Rear bumper / door',   hint: 'Low and close — the roll-up track and rear door edge', group: 'Detail' },
  { id: 'LIFT_GATE',     label: 'Lift gate / ramp',     hint: 'Deployed if it has one. Skip if this truck has neither', group: 'Detail' },

  // INTERIOR keeps its id — it is on every photo taken before today.
  { id: 'INTERIOR',        label: 'Cab interior',       hint: 'Seats and floor', group: 'Interior' },
  { id: 'DASH',            label: 'Dash & controls',    hint: 'Whole dash, including any warning lights showing', group: 'Interior' },
  { id: 'CARGO_INTERIOR',  label: 'Cargo area',         hint: 'Full length of the box or cargo space, walls and floor', group: 'Interior' },

  { id: 'ODOMETER',   label: 'Odometer',   hint: 'Close enough to read the number', group: 'Gauges' },
  { id: 'FUEL_GAUGE', label: 'Fuel gauge', hint: 'Needle clearly visible', group: 'Gauges' },
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
