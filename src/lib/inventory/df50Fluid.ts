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
 * WHICH FLUID. The catalog carries TWO fluid rows: `DF50FLUID` "DF50 Hazer
 * Fluid, 1 Gallon" and an older hand-entered row whose code is its own
 * name, typo included ("DF50 Hazer Fuid"). The first run of this task
 * found both and refused to choose. Wes 2026-09-17: "make it suggest DF-50
 * haze fluid, 1 gallon, as the only option." So the gallon row is PINNED by
 * code and goes on all three machines — the EFX row, water-based and
 * oil-based alike (the same three the pick-list check covers). The name
 * search below is only the fallback for the day that code is gone: one
 * fluid-named row is taken, more than one is refused rather than guessed.
 * The typo'd row is left alone — it may sit on old order lines — and the
 * task says so in its log.
 */

/** The DF-50 catalog rows — the same three the pick-list check names. */
export const DF50_HAZER_CODES = ['EFX-DF50-HAZER', '104417', '104418'] as const

/** The fluid that goes out with every DF-50: "DF50 Hazer Fluid, 1 Gallon"
 *  (Wes 2026-09-17, "as the only option"). */
export const DF50_FLUID_CODE = 'DF50FLUID'

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

export interface FluidChoice<T> {
  fluid: T | null
  /** How it was chosen, for the log — or why it was not. */
  reason: string
}

/**
 * The one fluid row every DF-50 takes. The pinned gallon wins whenever it
 * is present; otherwise a lone fluid-named row is taken; otherwise nothing,
 * with the candidates named so a person can fix the catalog.
 */
export function chooseDf50Fluid<T extends { code: string; description: string | null }>(rows: T[]): FluidChoice<T> {
  const name = (r: T) => `${r.code} "${r.description ?? ''}"`
  const pinned = rows.find((r) => r.code.trim().toUpperCase() === DF50_FLUID_CODE)
  if (pinned) return { fluid: pinned, reason: `pinned by code ${DF50_FLUID_CODE}` }
  const named = rows.filter(isDf50FluidRow)
  if (named.length === 1) return { fluid: named[0], reason: `the only row named as DF-50 fluid (${DF50_FLUID_CODE} not found)` }
  if (named.length === 0) return { fluid: null, reason: `no row coded ${DF50_FLUID_CODE} and none named as DF-50 fluid` }
  return {
    fluid: null,
    reason: `no row coded ${DF50_FLUID_CODE}, and ${named.length} rows named as DF-50 fluid (${named.map(name).join(', ')})`,
  }
}
