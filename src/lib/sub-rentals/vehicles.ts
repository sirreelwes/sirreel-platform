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
