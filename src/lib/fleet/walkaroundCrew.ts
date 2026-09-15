/**
 * Who did the walk-around — picked on the screen, every time.
 *
 * Wes, 2026-09-15: check-outs and check-ins are done by "anyone from the
 * warehouse, but most likely Julian, Andy, or Frankie", and Andy and
 * Frankie share fleet@sirreel.com. So the signed-in account cannot say
 * who stood in front of the truck: `Inspection.inspectedBy` would read
 * "fleet" for two different people. The person picks their name, and
 * the name — not the login — is what the record shows.
 *
 * Deliberately never defaulted from the session, for the same reason the
 * order check sheets aren't (src/lib/orders/checkPasses.ts): a yard
 * phone is signed in as whoever used it last.
 *
 * Adding someone who does this regularly is a one-line change here.
 * Anyone else types their name under "Someone else".
 */

export const WALKAROUND_CREW: readonly string[] = ['Julian', 'Andy', 'Frankie']

const MAX_LEN = 60

/** Trimmed, single-spaced, capped — or null when there is no name. */
export function normalizeInspectorName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.replace(/\s+/g, ' ').trim().slice(0, MAX_LEN)
  return name || null
}

export const INSPECTOR_NAME_REQUIRED = 'Pick who did this walk-around'

/**
 * The name to show for a filed walk-around. The picked name wins; a row
 * filed before the picker existed falls back to the login's name, and a
 * driver's self-serve row to the driver.
 */
export function inspectorDisplayName(i: {
  inspectorName?: string | null
  inspectedByUser?: { name: string | null; email?: string | null } | null
  inspectedByDriver?: { firstName: string; lastName: string } | null
}): { name: string | null; byDriver: boolean } {
  if (i.inspectorName) return { name: i.inspectorName, byDriver: false }
  if (i.inspectedByUser?.name) return { name: i.inspectedByUser.name, byDriver: false }
  if (i.inspectedByDriver) {
    const n = `${i.inspectedByDriver.firstName} ${i.inspectedByDriver.lastName}`.trim()
    return { name: n || null, byDriver: true }
  }
  if (i.inspectedByUser?.email) return { name: i.inspectedByUser.email, byDriver: false }
  return { name: null, byDriver: false }
}
