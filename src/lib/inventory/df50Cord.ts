/**
 * The DF-50's power cord belongs to the MACHINE, not to its fluid — the
 * RULE, no database.
 *
 * Wes 2026-09-17: "The IEC POWER CORD EDISON is attached to the DF50 Hazer
 * Fluid 1 Gallon. It should be attached to the DF50 Hazer."
 *
 * A jug of haze fluid has no socket. The cord was hung off the fluid row,
 * so every order that took the fluid quietly pulled a cord with it and
 * every order that took ONLY the machine — the machine goes out pre-juiced,
 * so that happens — got no cord at all. Exactly backwards, and invisible
 * on the quote because the link is warehouse-side.
 *
 * WHICH MACHINE. All three, the same three the fluid kit and the pick-list
 * check already name (DF50_HAZER_CODES): every machine that goes out needs
 * its own cord, and a machine-by-machine guess is what put the cord on a
 * jug in the first place.
 *
 * WHICH CORD. Matched on the name Wes used. The catalog is full of Edison
 * cable — 25' and 50' stingers, adapters — and none of those is this, so
 * the match demands BOTH "IEC" and a cord/cable word rather than reaching
 * for anything Edison. More than one match is REFUSED, never guessed.
 */

/** A catalog row that is the DF-50's IEC power cord. */
const IEC = /\biec\b/i
const CORDLIKE = /\b(cord|cable|lead)\b/i

export function isIecCordRow(row: { code: string; description: string | null }): boolean {
  const text = `${row.code} ${row.description ?? ''}`
  return IEC.test(text) && CORDLIKE.test(text)
}

export interface CordChoice<T> {
  cord: T | null
  /** How it was chosen, for the log — or why it was not. */
  reason: string
}

/**
 * The one cord row. A single IEC-named row wins; none or several is
 * nothing, with the candidates named so a person can fix the catalog
 * rather than have the script pick a cable at random.
 */
export function chooseIecCord<T extends { code: string; description: string | null }>(rows: T[]): CordChoice<T> {
  const name = (r: T) => `${r.code} "${r.description ?? ''}"`
  const named = rows.filter(isIecCordRow)
  if (named.length === 1) return { cord: named[0], reason: `the only row named as an IEC cord` }
  if (named.length === 0) return { cord: null, reason: 'no row is named as an IEC power cord' }
  return { cord: null, reason: `${named.length} rows are named as an IEC cord (${named.map(name).join(', ')})` }
}

/**
 * Whether a kit link hanging off `parent` is one this task should take
 * down — the cord on anything that is NOT a DF-50 machine.
 *
 * Deliberately not "the cord on the fluid": the complaint named the fluid,
 * but the fault is the cord sitting on a row that is not a machine, and a
 * rule written to the one row Wes happened to look at would miss the typo'd
 * fluid row beside it.
 */
export function cordIsMisplaced(
  parent: { code: string; description: string | null },
  machineCodes: readonly string[],
): boolean {
  return !machineCodes.some((c) => c.toUpperCase() === parent.code.trim().toUpperCase())
}
