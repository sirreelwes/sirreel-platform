/**
 * The blind-handoff RULE, pure — no prisma, so the order page, the job
 * page and the board (client components) can share it with the API.
 * The database loaders and the story behind the rule are in
 * ./blindHandoff.ts, which re-exports everything here.
 */

export interface BlindOrderLike {
  bookingId: string | null
  blindPickup: boolean
  blindReturn: boolean
}

/** The per-vehicle override as stored: null = follow the order. */
export interface BlindOverrideLike {
  blindPickup: boolean | null
  blindReturn: boolean | null
}

export interface BlindFlags {
  blindPickup: boolean
  blindReturn: boolean
  any: boolean
}

/** The orders that speak for one booking (pure — see the rule above). */
export function ordersForBooking<T extends BlindOrderLike>(
  orders: T[],
  bookingId: string | null,
  liveBookingIds: ReadonlySet<string>,
): T[] {
  if (bookingId) {
    const bound = orders.filter((o) => o.bookingId === bookingId)
    if (bound.length) return bound
  }
  return orders.filter((o) => !o.bookingId || !liveBookingIds.has(o.bookingId))
}

/** The order-level answer for a set of orders. */
export function blindFlags(orders: BlindOrderLike[]): BlindFlags {
  const blindPickup = orders.some((o) => o.blindPickup)
  const blindReturn = orders.some((o) => o.blindReturn)
  return { blindPickup, blindReturn, any: blindPickup || blindReturn }
}

/**
 * The effective answer for ONE vehicle: its own override where set, else
 * the orders that speak for its booking. Pure.
 */
export function blindForVehicle(
  orders: BlindOrderLike[],
  override: BlindOverrideLike | null | undefined,
): BlindFlags {
  const base = blindFlags(orders)
  const blindPickup = override?.blindPickup ?? base.blindPickup
  const blindReturn = override?.blindReturn ?? base.blindReturn
  return { blindPickup, blindReturn, any: blindPickup || blindReturn }
}

/** True when the vehicle carries its own answer on this edge (not following the order). */
export function hasOverride(override: BlindOverrideLike | null | undefined, kind: 'blindPickup' | 'blindReturn'): boolean {
  return override?.[kind] != null
}

/**
 * "Is anything on this job blind?" — the job-level rollup for the /jobs
 * rail, the paperwork strip, the dispatch cards and the client portal:
 * any order flag, or any vehicle overridden ON. A vehicle overridden OFF
 * does not un-blind the job while a sibling is still blind.
 */
export function jobBlindRollup(
  orders: Array<{ blindPickup: boolean; blindReturn: boolean }>,
  overrides: Array<BlindOverrideLike>,
): { blindPickup: boolean; blindReturn: boolean } {
  return {
    blindPickup: orders.some((o) => o.blindPickup) || overrides.some((v) => v.blindPickup === true),
    blindReturn: orders.some((o) => o.blindReturn) || overrides.some((v) => v.blindReturn === true),
  }
}

