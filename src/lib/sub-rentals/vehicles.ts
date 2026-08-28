/**
 * Shared helpers for the subcontracted-vehicle roster (API + pages).
 * Page files can't export helpers themselves (next build's route-type
 * validation rejects stray exports), so anything two surfaces share
 * lives here.
 */

export function fmtMoney(v: string | number | null): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n)
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—'
}

/** list × (1 − discount/100), or null when either side is missing. */
export function netCost(list: string | null, discountPercent: string | null): number | null {
  if (list == null || discountPercent == null) return null
  const l = Number(list)
  const d = Number(discountPercent)
  if (!Number.isFinite(l) || !Number.isFinite(d)) return null
  return Math.round(l * (1 - d / 100) * 100) / 100
}

/**
 * Parse a discount percent — outside parseMoney's cents-rounding
 * world: 0–100, up to 2 decimals. Anything unparseable or out of
 * range is null (treated as "not set", never an error).
 */
export function parsePercent(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v.trim()) : (v as number)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n * 100) / 100
}

// ── Ancillary fees ──────────────────────────────────────────────────
// String-literal mirrors of the Prisma enums. Deliberately NOT imported
// from '@prisma/client': this module is pulled into client components,
// and importing the generated client there drags the whole engine into
// the browser bundle.

export type SubFeeUnit = 'FLAT' | 'PER_DAY' | 'PER_HOUR' | 'PER_MILE' | 'PER_GALLON' | 'PERCENT'
export type SubFeeUnionScope = 'ALL' | 'NON_UNION' | 'UNION'

export const SUB_FEE_UNITS: { value: SubFeeUnit; label: string }[] = [
  { value: 'PER_DAY', label: 'per day' },
  { value: 'PER_HOUR', label: 'per hour' },
  { value: 'PER_MILE', label: 'per mile' },
  { value: 'PER_GALLON', label: 'per gallon' },
  { value: 'FLAT', label: 'flat' },
  { value: 'PERCENT', label: '% of rate' },
]

const UNIT_SUFFIX: Record<SubFeeUnit, string> = {
  PER_DAY: '/ day',
  PER_HOUR: '/ hr',
  PER_MILE: '/ mile',
  PER_GALLON: '/ gal',
  FLAT: 'flat',
  PERCENT: '',
}

export const UNION_SCOPE_LABEL: Record<SubFeeUnionScope, string> = {
  ALL: 'All jobs',
  NON_UNION: 'Non-union',
  UNION: 'Union',
}

export interface FeeLike {
  amount: string | number
  unit: SubFeeUnit
  coversHours?: string | number | null
}

/**
 * Human rate string for a fee row: "$550.00 / day", "$2.95 / mile",
 * "20%". PERCENT is a percentage, not dollars, so it never gets a $.
 */
export function formatFeeRate(fee: FeeLike): string {
  const n = Number(fee.amount)
  if (!Number.isFinite(n)) return '—'
  if (fee.unit === 'PERCENT') return `${n}%`
  const suffix = UNIT_SUFFIX[fee.unit]
  return suffix ? `${fmtMoney(n)} ${suffix}` : fmtMoney(n)
}

/**
 * The qualifier a bare unit can't carry — "covers 10 hrs" on shift-
 * priced labor. Returns null when there's nothing to add, so callers
 * can skip the element entirely rather than render an empty node.
 */
export function coversHoursNote(fee: FeeLike): string | null {
  if (fee.coversHours == null || fee.coversHours === '') return null
  const h = Number(fee.coversHours)
  if (!Number.isFinite(h) || h <= 0) return null
  const hourly = Number(fee.amount) / h
  const hrs = Number.isInteger(h) ? String(h) : h.toFixed(1)
  return Number.isFinite(hourly)
    ? `covers ${hrs} hrs · ${fmtMoney(Math.round(hourly * 100) / 100)}/hr`
    : `covers ${hrs} hrs`
}

/**
 * What WE pay for this fee. Most ancillaries are pass-through, so the
 * discount only bites when the fee is explicitly marked
 * discountApplies — returns null in that (common) case so the UI can
 * show a dash rather than restating the list amount as if it were a
 * separate negotiated number.
 */
export function feeNetAmount(
  fee: FeeLike & { discountApplies: boolean },
  discountPercent: string | null,
): number | null {
  if (!fee.discountApplies || fee.unit === 'PERCENT') return null
  return netCost(String(fee.amount), discountPercent)
}
