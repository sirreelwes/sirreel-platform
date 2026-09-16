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
 *
 * History: 7 slots (2026-09-02) → a 22-slot draft of DamageID's list
 * (2026-09-08, Hugo: seven couldn't defend a claim) → Julian's actual
 * DamageID list, 23 shots in his order (2026-09-15).
 */

export interface PhotoPosition {
  /** Stored value. Never rename one of these — old photos keep it. */
  id: string
  /** What the tech reads on the button — Julian's words, verbatim. */
  label: string
  /** The one-line instruction under it. Concrete beats exhaustive. */
  hint: string
  /** Section heading in the capture UI. Sections are CONTIGUOUS runs of
   *  the list, so grouping never reorders the walk. */
  group: PhotoGroup
  /** Which side of the truck, when the label alone doesn't say. Julian's
   *  list has "Front tire" and "Rear tire" twice each — in the walk the
   *  section says which, but an email or a thumbnail title has no
   *  section, so positionLabel() appends this. */
  side?: 'driver side' | 'passenger side'
}

export type PhotoGroup =
  | 'Cab'
  | 'Driver side'
  | 'Front'
  | 'Passenger side'
  | 'Rear & inside'
  | 'Remote & paperwork'
  | 'Driver'
  | 'Seating'
  | 'Earlier angles'

/** Section order for the capture screen and the filed record. */
export const PHOTO_GROUPS: readonly PhotoGroup[] = [
  'Cab', 'Driver side', 'Front', 'Passenger side', 'Rear & inside', 'Remote & paperwork', 'Driver',
  'Seating', 'Earlier angles',
] as const

/** The one slot that is about the PERSON, not the truck. */
export const DRIVERS_LICENSE_POSITION = 'DRIVERS_LICENSE'

/**
 * The staff walk-around — Julian's DamageID shot list, in his order, in
 * his words (2026-09-15, Wes: "the text to follow damage IDs on each
 * photo… keep it in this exact order"). HQ is replacing DamageID, so the
 * crew should not have to learn a second sequence: this is the order
 * they already walk. Cab first; then the driver side starting at the
 * REAR corner and working forward, round the front, back down the
 * passenger side, the rear and the inside, and last the loose items and
 * the driver. Don't "tidy" it into front-to-back — the numbers on the
 * capture screen are the numbers the crew knows.
 *
 * Where one of Julian's shots is an angle the earlier 22-slot draft
 * already had, it REUSES that id (DASH, the corners, the wheels,
 * WINDSHIELD, FRONT, REAR, CARGO_INTERIOR) so the handful of photos
 * already filed still line up with a check-in shot of the same angle.
 * Only the label and hint changed. Ids are never renamed.
 *
 * Driver's license is last and check-OUT only. The licence may already
 * be on file from the driver's email check-in, but Julian wants it shot
 * at the truck anyway: productions swap drivers, and the photo is the
 * record of who actually drove off. It is not part of the check-in, and
 * it never goes in the renter-facing condition report.
 */
const WALKAROUND: readonly PhotoPosition[] = [
  { id: 'DASH',        label: 'Dashboard',   hint: 'Whole dash with the key on — odometer, fuel gauge and any warning lights readable', group: 'Cab' },
  { id: 'VISORS',      label: 'Visors',      hint: 'Both sun visors, flipped down', group: 'Cab' },
  { id: 'CUP_HOLDERS', label: 'Cup holders', hint: 'Cup holders and center console', group: 'Cab' },
  { id: 'LOCKBOX',     label: 'Lockbox',     hint: 'The lockbox, clearly in frame', group: 'Cab' },

  { id: 'REAR_DRIVER_CORNER',  label: 'Driver side rear',   hint: 'Three-quarter angle — driver side and rear in one frame', group: 'Driver side' },
  { id: 'WHEEL_DRIVER_REAR',   label: 'Rear tire',          hint: 'Driver side — rim face and sidewall', group: 'Driver side', side: 'driver side' },
  { id: 'FUEL_CAP',            label: 'Fuel cap',           hint: 'Fuel door open, cap in place', group: 'Driver side' },
  { id: 'DRIVER_MIRROR',       label: 'Driver side mirror', hint: 'Mirror glass and housing', group: 'Driver side' },
  { id: 'FRONT_DRIVER_CORNER', label: 'Driver side front',  hint: 'Three-quarter angle — driver side and front in one frame', group: 'Driver side' },
  { id: 'WHEEL_DRIVER_FRONT',  label: 'Front tire',         hint: 'Driver side — rim face and sidewall', group: 'Driver side', side: 'driver side' },

  { id: 'WINDSHIELD', label: 'Windshield', hint: 'Whole glass, angled so chips show', group: 'Front' },
  { id: 'FRONT',      label: 'Front',      hint: 'Straight on, whole front end in frame', group: 'Front' },

  { id: 'PASSENGER_MIRROR',       label: 'Pass side mirror', hint: 'Mirror glass and housing', group: 'Passenger side' },
  { id: 'WHEEL_PASSENGER_FRONT',  label: 'Front tire',       hint: 'Passenger side — rim face and sidewall', group: 'Passenger side', side: 'passenger side' },
  { id: 'FRONT_PASSENGER_CORNER', label: 'Pass side front',  hint: 'Three-quarter angle — passenger side and front in one frame', group: 'Passenger side' },
  { id: 'WHEEL_PASSENGER_REAR',   label: 'Rear tire',        hint: 'Passenger side — rim face and sidewall', group: 'Passenger side', side: 'passenger side' },
  { id: 'REAR_PASSENGER_CORNER',  label: 'Pass side rear',   hint: 'Three-quarter angle — passenger side and rear in one frame', group: 'Passenger side' },

  { id: 'REAR',           label: 'Rear',            hint: 'Straight on, including the liftgate or roll-up', group: 'Rear & inside' },
  { id: 'INSIDE_ROOF',    label: 'Inside roof',     hint: 'The ceiling inside — punctures and scrapes show here', group: 'Rear & inside' },
  { id: 'CARGO_INTERIOR', label: 'Inside complete', hint: 'The whole inside in one frame — walls and floor', group: 'Rear & inside' },

  { id: 'REMOTE',                 label: 'Remote',           hint: 'Every remote going out with the vehicle', group: 'Remote & paperwork' },
  { id: 'PAPERWORK',              label: 'Paperwork',        hint: 'Registration and insurance card, readable', group: 'Remote & paperwork' },
  { id: DRIVERS_LICENSE_POSITION, label: 'Driver’s license', hint: 'Whoever is driving it off — front of the card, readable. Shoot it even if one is on file: drivers get swapped', group: 'Driver' },
] as const

/** Check-out: all 23, in order. */
export const REQUIRED_POSITIONS: readonly PhotoPosition[] = WALKAROUND

/** Check-in: the same walk without the licence. The licence records who
 *  took the truck; there is nothing on the way back to compare it to. */
export const RETURN_POSITIONS: readonly PhotoPosition[] =
  WALKAROUND.filter((p) => p.id !== DRIVERS_LICENSE_POSITION)

export type WalkaroundEdge = 'OUT' | 'IN'

export function positionsFor(edge: WalkaroundEdge): readonly PhotoPosition[] {
  return edge === 'IN' ? RETURN_POSITIONS : REQUIRED_POSITIONS
}

/**
 * Angles from before Julian's list that it does not ask for. Kept so the
 * photos already filed under them still have a name, and because the
 * driver self-serve pages still use four of them (the flat sides,
 * odometer, fuel gauge, interior) — Wes wants drivers kept light.
 * Rendered under "Earlier angles" only when a photo actually sits in one.
 */
export const LEGACY_POSITIONS: readonly PhotoPosition[] = [
  { id: 'DRIVER_SIDE',    label: 'Driver side',    hint: 'Full length of the driver side', group: 'Earlier angles' },
  { id: 'PASSENGER_SIDE', label: 'Passenger side', hint: 'Full length of the passenger side', group: 'Earlier angles' },
  { id: 'ROOF',           label: 'Roof / top',     hint: 'From the mirror or a step — scrapes from low clearances live here', group: 'Earlier angles' },
  { id: 'FRONT_BUMPER',   label: 'Front bumper',   hint: 'Low and close, full width', group: 'Earlier angles' },
  { id: 'REAR_BUMPER',    label: 'Rear bumper / door', hint: 'Low and close — the roll-up track and rear door edge', group: 'Earlier angles' },
  { id: 'LIFT_GATE',      label: 'Lift gate / ramp', hint: 'Deployed if it has one', group: 'Earlier angles' },
  { id: 'INTERIOR',       label: 'Cab interior',   hint: 'Seats and floor', group: 'Earlier angles' },
  { id: 'ODOMETER',       label: 'Odometer',       hint: 'Close enough to read the number', group: 'Earlier angles' },
  { id: 'FUEL_GAUGE',     label: 'Fuel gauge',     hint: 'Needle clearly visible', group: 'Earlier angles' },
] as const

/**
 * Seat rows — passenger vans only (Julian, 2026-09-15: "for the pass vans
 * we take pictures of each row. Can you add a couple extra spots").
 *
 * OPTIONAL, and offered on BOTH ends: a row photo is only worth taking if
 * there is one to compare it to, and the rows are where a passenger van
 * actually gets damaged — torn seat backs, stained cloth, missing belts.
 * Not in the 23: a Cube has no rows, and padding every truck's required
 * count with slots that do not apply is how a crew learns to ignore the
 * counter.
 *
 * A 15-passenger van walks four rows behind the driver; a 12 walks three
 * and leaves the last one empty. Optional means an empty slot is not a
 * deficiency, so one list covers both without asking the tech which van
 * they are standing in front of.
 */
export const SEATING_POSITIONS: readonly PhotoPosition[] = [
  { id: 'SEATS_ROW_2', label: 'Second row',  hint: 'Whole row — seat backs, cushions and belts', group: 'Seating' },
  { id: 'SEATS_ROW_3', label: 'Third row',   hint: 'Whole row — seat backs, cushions and belts', group: 'Seating' },
  { id: 'SEATS_ROW_4', label: 'Fourth row',  hint: 'Whole row — seat backs, cushions and belts', group: 'Seating' },
  { id: 'SEATS_ROW_5', label: 'Back row',    hint: 'The last row — and the floor behind it', group: 'Seating' },
] as const

/**
 * The extra slots a particular unit earns, by its CATEGORY NAME (the
 * yard screens have the name, not the code). Everything here is optional
 * — `positionsFor` is still the contract both ends share.
 */
export function extraPositionsFor(categoryName: string | null | undefined): readonly PhotoPosition[] {
  if (!categoryName) return []
  // "Passenger Van" today; matches a split/renamed row ("15-Passenger
  // Van", "Pass Van") without a second registry to keep in step.
  return /passenger van|pass van/i.test(categoryName) ? SEATING_POSITIONS : []
}

/** Every slot id that has ever been valid. */
export const ALL_POSITIONS: readonly PhotoPosition[] = [...WALKAROUND, ...SEATING_POSITIONS, ...LEGACY_POSITIONS]

/** Close-ups of specific damage. Unlimited, and never required. */
export const DAMAGE_POSITION = 'DAMAGE'

/** Anything shot before the guided capture existed, or an extra. */
export const OTHER_LABEL = 'Other'

const BY_ID = new Map(ALL_POSITIONS.map((p) => [p.id, p]))

export function positionById(id: string): PhotoPosition | undefined {
  return BY_ID.get(id)
}

/** A slot's name OUT of the walk — "Rear tire · driver side". Inside the
 *  capture screen the section already says which side; use `label`. */
export function positionLabel(position: string | null | undefined): string {
  if (!position) return OTHER_LABEL
  if (position === DAMAGE_POSITION) return 'Damage close-up'
  const slot = BY_ID.get(position)
  if (!slot) return position
  return slot.side ? `${slot.label} · ${slot.side}` : slot.label
}

/** Guards the stored value — anything unrecognised is dropped to null
 *  rather than written through, so the column stays readable. */
export function normalizePosition(position: unknown): string | null {
  if (typeof position !== 'string') return null
  if (position === DAMAGE_POSITION) return position
  return BY_ID.has(position) ? position : null
}

/** Which slots have no photo yet. Drives the "3 of 23" counter and the
 *  soft warning on submit — soft because a tech standing in front of a
 *  truck at 6am must never be locked out of recording what they can see. */
export function missingPositions(
  taken: Iterable<string | null | undefined>,
  positions: readonly PhotoPosition[] = REQUIRED_POSITIONS,
): PhotoPosition[] {
  const have = new Set([...taken].filter(Boolean) as string[])
  return positions.filter((p) => !have.has(p.id))
}
