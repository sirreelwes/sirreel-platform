/**
 * The closed-day handoff question, as rules rather than as a form.
 *
 * Wes 2026-09-13: "We are closed on sundays, so all pickups and returns
 * on that day should be asked: Is this a blind pickup/dropoff?"
 *
 * A Sunday pickup is not an error and is never blocked — productions
 * load on Sundays all the time. What it is, is a handoff with nobody at
 * the gate unless someone comes in for it, and that is a decision the
 * desk makes when the date is picked rather than one the client
 * discovers standing at a locked gate.
 *
 * Answering BLIND sets the order's EXISTING `blindPickup` /
 * `blindReturn` columns — the ones that already drive the portal
 * instructions, the driver's gate + lockbox codes, the driver self
 * check-out, and the loud "needs check-in" alert on the inbound dispatch
 * lane. This adds a question, not a second notion of an unstaffed
 * handoff.
 *
 * Which days are closed is `isClosedDay` in lib/site/yardHours — the
 * same module where YARD_HOURS says "Closed Sunday" in prose.
 *
 * The question and the gate that insists on an answer live together on
 * purpose: a surface that rendered the prompt but forgot the blocker
 * would ask and then quietly drop the answer.
 */

import { isClosedDay } from '@/lib/site/yardHours'

export type ClosedDayAnswer = 'BLIND' | 'STAFFED'

export interface ClosedDayHandoff {
  /** The client lets themselves in, or we open up for them. */
  pickup: ClosedDayAnswer | null
  dropoff: ClosedDayAnswer | null
}

export const NO_CLOSED_DAY_ANSWERS: ClosedDayHandoff = { pickup: null, dropoff: null }

/** Which ends of the window land on a day the yard is closed. */
export function closedDayAsks(start: string | null | undefined, end: string | null | undefined) {
  return { pickup: isClosedDay(start), dropoff: isClosedDay(end) }
}

/** What is still unanswered — phrased for a "Still needed:" strip. */
export function closedDayBlockers(
  start: string | null | undefined,
  end: string | null | undefined,
  value: ClosedDayHandoff,
): string[] {
  const asks = closedDayAsks(start, end)
  const out: string[] = []
  if (asks.pickup && !value.pickup) out.push('is the Sunday pickup blind?')
  if (asks.dropoff && !value.dropoff) out.push('is the Sunday drop-off blind?')
  return out
}

/**
 * The answers as the order columns they set. A side that was never asked
 * (a weekday pickup) is false — this is only ever the value a brand-new
 * order is CREATED with, and the order page's Blind handoff card stays
 * the place to turn one on later.
 */
export function blindFlagsFor(
  start: string | null | undefined,
  end: string | null | undefined,
  value: ClosedDayHandoff,
): { blindPickup: boolean; blindReturn: boolean } {
  const asks = closedDayAsks(start, end)
  return {
    blindPickup: asks.pickup && value.pickup === 'BLIND',
    blindReturn: asks.dropoff && value.dropoff === 'BLIND',
  }
}

/** Drops an answer whose date is no longer a closed day, so a "blind"
 *  given for a Sunday cannot ride along after the rep moves it to
 *  Monday. Returns the SAME object when nothing changed, so callers can
 *  derive it every render without churning state. */
export function pruneClosedDayAnswers(
  start: string | null | undefined,
  end: string | null | undefined,
  value: ClosedDayHandoff,
): ClosedDayHandoff {
  const asks = closedDayAsks(start, end)
  const pickup = asks.pickup ? value.pickup : null
  const dropoff = asks.dropoff ? value.dropoff : null
  if (pickup === value.pickup && dropoff === value.dropoff) return value
  return { pickup, dropoff }
}
