/**
 * How many units of one category a quote needs AT ONCE — PURE, no
 * database, so the arithmetic is testable offline
 * (tests/orders/peak-concurrent-hold.test.ts).
 *
 * WHY THIS EXISTS. The hold builder used to SUM the quoted lines in a
 * category and give the total one envelope (min pickup → max return).
 * That is right when the lines run together and wrong when they run in
 * sequence: USC Short Film Production (S260910-002, 2026-09-10) quoted
 * ONE cargo van for three separate four-day blocks — Sep 18-21, Sep
 * 25-28, Oct 2-5 — and the hold came out as 3 × Cargo Van across Sep 18
 * → Oct 5. Three vans blocked for eighteen days for a job that never
 * needs more than one, and two of the three slots could never be filled
 * by anything but a phantom (Wes: "why didn't it just assign this
 * vehicle for all of the date span requests?").
 *
 * The number that matters is the PEAK: the most units live on any single
 * day. Sequential blocks peak at 1; genuinely concurrent lines still sum,
 * so the two-vans-at-once case this module was originally written for
 * (S260903-002, High Horses) is unchanged.
 *
 * ── Two deliberate choices ──────────────────────────────────────────
 *
 * · Overlap is INCLUSIVE of both endpoints. A line returning the 21st
 *   and another leaving the 21st peak at 2 — one van cannot do both, and
 *   the same-day handoff is dispatch's call to make, not an assumption
 *   to bake into a hold.
 * · No turnaround buffer. The buffer is the availability engine's axis
 *   (`computeUnitStates` renders a too-close pick as "tight" and the
 *   operator confirms it); folding it in here would inflate the hold
 *   itself, which is the failure being fixed.
 *
 * The envelope is still min → max, so a one-van hold does block that van
 * across the gap weeks. That is the remaining approximation and it is
 * the safe direction: the fleet is over-held by DAYS on one unit rather
 * than over-held by UNITS.
 */

export interface HoldWindow {
  /** Inclusive. Day granularity — @db.Date columns are UTC midnight. */
  start: Date
  /** Inclusive. */
  end: Date
  /** Units this line asks for over that window. */
  quantity: number
}

/**
 * The largest number of units live on any one day across `windows`.
 * Returns 0 for an empty list.
 *
 * The peak always occurs on some window's START day — demand only ever
 * rises when a window opens — so those are the only points worth
 * testing. n is a handful of quote lines; the O(n²) sweep is free and
 * reads like the definition.
 */
export function peakConcurrent(windows: HoldWindow[]): number {
  let peak = 0
  for (const probe of windows) {
    const day = probe.start.getTime()
    let live = 0
    for (const w of windows) {
      if (w.start.getTime() <= day && w.end.getTime() >= day) live += w.quantity
    }
    if (live > peak) peak = live
  }
  return peak
}
