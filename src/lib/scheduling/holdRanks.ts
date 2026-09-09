/**
 * Hold queue depth.
 *
 * 1st Hold / 2nd Hold / 3rd Hold — the reservation desk's own words for
 * `BookingItem.holdRank`. Capped at 3 (Wes 2026-09-09): a queue deeper
 * than that on one truck is a sub-rental conversation, not a
 * reservation.
 *
 * Lives in lib, NOT in the rank route, because Next validates the
 * exports of a `route.ts` — a stray `export const` there passes
 * `tsc --noEmit` and fails `next build` ("does not match the required
 * types of a Next.js Route"). See CLAUDE.md.
 */
export const MAX_HOLD_RANK = 3

/** "1st" / "2nd" / "3rd" — for buttons and audit strings. */
export function holdRankLabel(rank: number): string {
  if (rank === 1) return '1st'
  if (rank === 2) return '2nd'
  if (rank === 3) return '3rd'
  return `${rank}th`
}
