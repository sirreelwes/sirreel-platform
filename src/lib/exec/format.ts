/**
 * Number formatting shared by the owner numbers page (a server component) and
 * its charts (client components). It lives here, not in ColumnChart.tsx: a
 * function exported from a 'use client' module is a client reference on the
 * server, and calling it there throws at render — which `next build` does
 * not catch.
 */

/** 1,284 → $1.3K, 412,000 → $412K, 2,400,000 → $2.4M. */
export function compactMoney(n: number): string {
  const abs = Math.abs(n)
  // A trailing ".0" is noise on an axis tick: $25K, not $25.0K.
  const short = (v: number, digits: number) => v.toFixed(digits).replace(/\.0$/, '')
  if (abs >= 1_000_000) return `$${short(n / 1_000_000, abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `$${short(n / 1_000, abs >= 100_000 ? 0 : 1)}K`
  return `$${Math.round(n)}`
}
