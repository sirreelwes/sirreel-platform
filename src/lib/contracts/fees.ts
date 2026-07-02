/**
 * Contract fee constants — single source of truth (audit §4: these were
 * duplicated as prose across portal/[token]/page.tsx, the contract
 * download route, contractClauses.ts, and client/[token]/page.tsx).
 *
 * These are CONTRACT TERMS, not Fleet Pricing — they change only when the
 * rental agreement changes, and must stay in lockstep with
 * public/contracts/sirreel-rental-agreement.pdf (same rule as
 * contractClauses.ts).
 */

/** Limited Collision Damage Waiver, per day per vehicle. */
export const LCDW_DAILY_RATE = 24

/** Fuel shortfall charge per gallon on return. */
export const FUEL_PER_GALLON = 10

/** Non-smoking policy violation fee, per day (plus repair costs). */
export const SMOKING_FEE_PER_DAY = 250

/** With LCDW accepted, SirReel waives the first this-many dollars of
 *  collision damage (contract ¶4/LCDW addendum). */
export const LCDW_WAIVED_DAMAGE_LIMIT = 1000

/** "$24", "$250", "$1,000" — whole-dollar display. */
export const usd = (n: number) => `$${n.toLocaleString('en-US')}`

/** "$24.00", "$10.00" — cents display used in contract body text. */
export const usd2 = (n: number) => `$${n.toFixed(2)}`
