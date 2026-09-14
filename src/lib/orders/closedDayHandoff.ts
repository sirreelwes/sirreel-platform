/**
 * The out-of-hours handoff question, as rules rather than as a form.
 *
 * Wes 2026-09-13: "We are closed on sundays, so all pickups and returns
 * on that day should be asked: Is this a blind pickup/dropoff?" — and
 * 2026-09-14: "Also ask on Saturday after 3:30."
 *
 * A weekend handoff is not an error and is never blocked — productions
 * load on Sundays all the time. What it is, is a handoff with nobody at
 * the gate unless someone comes in for it, and that is a decision the
 * desk makes when the date is picked rather than one the client
 * discovers standing at a locked gate.
 *
 * The two closures ask genuinely different questions, so they are not
 * flattened into one "is it the weekend":
 *   CLOSED_ALL_DAY (Sunday)   — blind, or somebody opens up. Two answers.
 *   AFTER_CLOSE (Saturday)    — the yard is staffed until 3:30 PM, so the
 *                               FIRST thing asked is whether the handoff
 *                               is even after that. IN_HOURS is the
 *                               ordinary answer and sets nothing.
 * Nothing on an Order carries a pickup TIME (`@db.Date` columns, and no
 * form asks for one), so the Saturday hour is the rep's answer, not a
 * value we can read. That is why IN_HOURS exists at all.
 *
 * Answering BLIND sets the order's EXISTING `blindPickup` /
 * `blindReturn` columns — the ones that already drive the portal
 * instructions, the driver's gate + lockbox codes, the driver self
 * check-out, and the loud "needs check-in" alert on the inbound dispatch
 * lane. This adds a question, not a second notion of an unstaffed
 * handoff.
 *
 * When the yard is shut is `closureOn` in lib/site/yardHours — the same
 * module where YARD_HOURS prints those hours in prose.
 *
 * The question and the gate that insists on an answer live together on
 * purpose: a surface that rendered the prompt but forgot the blocker
 * would ask and then quietly drop the answer.
 */

import { calendarDayOf, closureOn, type YardClosure } from '@/lib/site/yardHours'

/** BLIND — they let themselves in. STAFFED — somebody opens up for them.
 *  IN_HOURS — it happens before the early-close, so no question arises;
 *  only ever a valid answer to an AFTER_CLOSE day. */
export type ClosedDayAnswer = 'BLIND' | 'STAFFED' | 'IN_HOURS'

/** An answer is remembered WITH the day it was given for. Anything less
 *  and a "blind" said about Sunday the 13th silently keeps standing when
 *  the rep moves the pickup to Saturday the 19th — a different question
 *  with a different answer, and gate codes on the client's portal for a
 *  handoff we might well be staffing. */
export interface ClosedDayAnswerRecord {
  day: string
  answer: ClosedDayAnswer
}

export interface ClosedDayHandoff {
  pickup: ClosedDayAnswerRecord | null
  dropoff: ClosedDayAnswerRecord | null
}

export const NO_CLOSED_DAY_ANSWERS: ClosedDayHandoff = { pickup: null, dropoff: null }

/** The closure each end of the window lands in, or null for a normal day. */
export function closedDayAsks(
  start: string | null | undefined,
  end: string | null | undefined,
): { pickup: YardClosure | null; dropoff: YardClosure | null } {
  return { pickup: closureOn(start), dropoff: closureOn(end) }
}

/** Does this record answer the question the window is asking right now?
 *  It has to be about THAT day, and sayable about that closure —
 *  IN_HOURS on a Sunday is not, there being no hours to be inside of. */
export function answerStands(
  day: string | null | undefined,
  closure: YardClosure | null,
  record: ClosedDayAnswerRecord | null,
): boolean {
  if (!closure || !record) return false
  if (record.day !== calendarDayOf(day)) return false
  return record.answer === 'IN_HOURS' ? closure.kind === 'AFTER_CLOSE' : true
}

/** What is still unanswered — phrased for a "Still needed:" strip. */
export function closedDayBlockers(
  start: string | null | undefined,
  end: string | null | undefined,
  value: ClosedDayHandoff,
): string[] {
  const asks = closedDayAsks(start, end)
  const out: string[] = []
  const ask = (
    day: string | null | undefined,
    closure: YardClosure | null,
    record: ClosedDayAnswerRecord | null,
    side: 'pickup' | 'drop-off',
  ) => {
    if (!closure || answerStands(day, closure, record)) return
    out.push(
      closure.kind === 'CLOSED_ALL_DAY'
        ? `is the Sunday ${side} blind?`
        : `what time is the Saturday ${side}?`,
    )
  }
  ask(start, asks.pickup, value.pickup, 'pickup')
  ask(end, asks.dropoff, value.dropoff, 'drop-off')
  return out
}

/**
 * The answers as the order columns they set. A side that was never asked
 * — or answered IN_HOURS, which means the yard is open for it — is
 * false. This is only ever the value a brand-new order is CREATED with;
 * the order page's Blind handoff card stays the place to turn one on
 * later.
 */
export function blindFlagsFor(
  start: string | null | undefined,
  end: string | null | undefined,
  value: ClosedDayHandoff,
): { blindPickup: boolean; blindReturn: boolean } {
  const asks = closedDayAsks(start, end)
  return {
    blindPickup:
      answerStands(start, asks.pickup, value.pickup) && value.pickup?.answer === 'BLIND',
    blindReturn:
      answerStands(end, asks.dropoff, value.dropoff) && value.dropoff?.answer === 'BLIND',
  }
}

/** Drops an answer the current dates can no longer carry — the date moved
 *  at all, or a Saturday "before 3:30" became a Sunday, which has no
 *  before. So a "blind" given for one day cannot ride along onto another.
 *  Returns the SAME object when nothing changed, so callers can derive it
 *  every render without churning state. */
export function pruneClosedDayAnswers(
  start: string | null | undefined,
  end: string | null | undefined,
  value: ClosedDayHandoff,
): ClosedDayHandoff {
  const asks = closedDayAsks(start, end)
  const pickup = answerStands(start, asks.pickup, value.pickup) ? value.pickup : null
  const dropoff = answerStands(end, asks.dropoff, value.dropoff) ? value.dropoff : null
  if (pickup === value.pickup && dropoff === value.dropoff) return value
  return { pickup, dropoff }
}
