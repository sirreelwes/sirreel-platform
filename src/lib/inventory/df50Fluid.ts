/**
 * The DF-50 hazer and its fluid — the RULE, no database.
 *
 * Wes 2026-09-17: "when the DF50 hazer is selected, it's supposed to bring
 * up the option immediately to add the fluid for that, which always goes
 * out. It's part of a kit."
 *
 * The Roscos got this on 2026-09-15 (scripts/seed-rosco-fluid-kits.ts) and
 * the DF-50 was left out ON PURPOSE — "it goes out pre-juiced; its extra
 * gallon is an ordinary add-on" — and the pick-list check for the DF-50
 * (kitChecklists.ts) said the same. Both were wrong, and Wes's words above
 * are the correction: the fluid goes out with every DF-50, so it is a
 * CHARGED kit piece like the Rosco fluids, added the moment the hazer line
 * lands (the /line-items and /from-parse routes already run the kit
 * reconciler on every add — the only thing missing was the link).
 *
 * WHY THE FLUID ROW IS FOUND BY NAME, NOT BY CODE. The catalog row for the
 * fluid was hand-entered with its NAME as its code, typo included ("DF50
 * Hazer Fuid"), and the June export is the last time it was written down
 * anywhere in this repo — codes minted since (RVHAZER, FOG1) appear in no
 * export at all. A pinned code that no longer matches would make the task
 * refuse forever; a pattern finds the row whatever it is called today, and
 * the task REFUSES when the pattern finds nothing or too much, naming what
 * it found so a person can fix the catalog rather than have a guess written.
 *
 * WATER vs OIL. The DF-50 exists as three catalog rows (the EFX row, a
 * water-based one, an oil-based one — same three the pick-list check
 * covers) and the fluids for the two chemistries are NOT interchangeable.
 * Today the catalog carries ONE fluid row and it goes on all three; if a
 * second row ever appears, each machine takes the fluid whose name says
 * the same chemistry, and a machine that cannot be matched without a guess
 * is refused, not guessed.
 */

/** The DF-50 catalog rows — the same three the pick-list check names. */
export const DF50_HAZER_CODES = ['EFX-DF50-HAZER', '104417', '104418'] as const

const DF50 = /\bdf\s*-?\s*50\b/i
const FLUID = /\b(fluid|fuid|juice)\b/i

/** A catalog row that is DF-50 fluid, however the name was typed. */
export function isDf50FluidRow(row: { code: string; description: string | null }): boolean {
  const text = `${row.code} ${row.description ?? ''}`
  return DF50.test(text) && FLUID.test(text)
}

/** A DF-50 row that is a MACHINE, not the fluid — belt and braces for a
 *  parent code that one day points at the wrong thing. */
export function isDf50MachineRow(row: { code: string; description: string | null }): boolean {
  const text = `${row.code} ${row.description ?? ''}`
  return DF50.test(text) && !FLUID.test(text)
}

export type Chemistry = 'water' | 'oil' | null

/** "Water Based" / "Oil Based" off a name; null when the name does not say. */
export function chemistryOf(row: { code: string; description: string | null }): Chemistry {
  const text = `${row.code} ${row.description ?? ''}`
  const water = /\bwater\b/i.test(text)
  const oil = /\boil\b/i.test(text)
  if (water && !oil) return 'water'
  if (oil && !water) return 'oil'
  return null
}

export interface Pairing<T> {
  parent: T
  piece: T | null
  /** Why no piece — the refusal text for this machine. */
  reason?: string
}

/**
 * Which fluid goes on which machine. One fluid row → every machine. More
 * than one → by chemistry, and a machine that cannot be matched without
 * guessing gets `piece: null` with the reason.
 */
export function pairFluidsToMachines<T extends { code: string; description: string | null }>(
  machines: T[],
  fluids: T[],
): Pairing<T>[] {
  if (fluids.length === 0) return machines.map((parent) => ({ parent, piece: null, reason: 'no DF-50 fluid row in the catalog' }))
  if (fluids.length === 1) return machines.map((parent) => ({ parent, piece: fluids[0] }))
  const name = (r: T) => `${r.code} "${r.description ?? ''}"`
  return machines.map((parent) => {
    const chem = chemistryOf(parent)
    const same = fluids.filter((f) => chemistryOf(f) === chem)
    if (same.length === 1) return { parent, piece: same[0] }
    // A machine whose name does not say, against fluids that do: nothing
    // to go on. A machine that says, against fluids that do not: same.
    const unsaid = fluids.filter((f) => chemistryOf(f) === null)
    if (chem !== null && same.length === 0 && unsaid.length === 1) return { parent, piece: unsaid[0] }
    return {
      parent,
      piece: null,
      reason: `${fluids.length} fluid rows (${fluids.map(name).join(', ')}) and no way to tell which is for ${name(parent)}${chem ? ` (${chem}-based)` : ''}`,
    }
  })
}
