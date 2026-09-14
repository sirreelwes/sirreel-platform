/**
 * The fuel gauge — one ladder, read by every surface that records a tank.
 *
 * Oliver, 2026-09-14: "on checking in and out vehicles, can fleet select
 * 1/8, 3/8, 5/8, and 7/8? Currently they can only choose from empty,
 * full, quarter full, half full, three quarters full." A real gauge is
 * marked in eighths, so quarters force a reading that is wrong by up to
 * an eighth of a tank in whichever direction the person rounds — and the
 * return comparison then calls a truck square that came back an eighth
 * down, or down when it is square.
 *
 * The same five strings were written out by hand in EIGHT places (two
 * API routes, two lib validators, two fleet forms, two driver cards),
 * each with its own copy of the error message, plus a ninth hand-keyed
 * table mapping them to fractions for the "came back lower" comparison.
 * Adding four values to five of those and missing the rest would have
 * been a 400 on submit for a reading the form offered. So the ladder
 * lives here and the fractions are DERIVED from position in it — a tenth
 * marking can be added without anyone re-doing arithmetic.
 *
 * Ordered full → empty, which is how the buttons read and how a gauge
 * sits. Stored as these exact strings on Inspection.fuelLevel and
 * CheckoutRecord.fuelOut/fuelIn; the old five are all still in the list,
 * so every reading already filed stays valid and keeps comparing.
 */

/** Every reading offered, fullest first. */
export const FUEL_LEVELS = [
  'full', '7/8', '3/4', '5/8', '1/2', '3/8', '1/4', '1/8', 'empty',
] as const

export type FuelLevel = (typeof FUEL_LEVELS)[number]

/** What the API routes and the driver-token libs check a body against. */
export const VALID_FUEL: ReadonlySet<string> = new Set<string>(FUEL_LEVELS)

/** One wording for the 400, so the message can never list a different
 *  set from the one the validator holds. */
export const FUEL_LEVEL_ERROR = `fuelLevel must be one of ${FUEL_LEVELS.join(', ')}`

/**
 * A reading as a fraction of a tank, or null when there isn't one.
 *
 * Derived from the rung's position rather than a parallel table: the two
 * drifting apart is how a gauge ends up disagreeing with itself. Null
 * for an unrecorded reading AND for a string off the ladder — a value
 * this module doesn't know is not a measurement of anything.
 */
export function fuelFraction(level: string | null | undefined): number | null {
  if (!level) return null
  const i = (FUEL_LEVELS as readonly string[]).indexOf(level)
  if (i < 0) return null
  return (FUEL_LEVELS.length - 1 - i) / (FUEL_LEVELS.length - 1)
}

/**
 * True only when the truck demonstrably came back on less fuel than it
 * left with. A missing reading at either end is not evidence of a
 * shortfall, so it does not produce one.
 */
export function cameBackLower(
  out: string | null | undefined,
  back: string | null | undefined,
): boolean {
  const a = fuelFraction(out)
  const b = fuelFraction(back)
  return a != null && b != null && b < a
}
