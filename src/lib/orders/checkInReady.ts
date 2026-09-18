/**
 * Can this order be checked IN yet?
 *
 * Wes, 2026-09-18: *"When they check it back in, say 'Begin Check In.'
 * That needs to only be possible when the order is back."*
 *
 * Until now the inbound sheet had no gate of any kind — every order whose
 * end date fell in the seven-day window opened straight into a countable
 * sheet, and a filed check-in advances the order to RETURNED, stamps
 * `Job.returnedAt` and drops the job off the board. Doing that to gear
 * still on a set is worse than a wrong number: nobody is looking for it
 * any more.
 *
 * Two things have to be true, and they fail differently:
 *
 *   1. IT WENT OUT. Gear that never left cannot come back. Proved by a
 *      check-OUT sheet on file (a partial counts — some of it left) or by
 *      the order having reached a status that only a departure writes.
 *   2. IT IS DUE. The end date has arrived.
 *
 * ── Why neither is a hard refusal ─────────────────────────────────────
 *
 * Both are inferences about the physical world from paperwork that runs
 * behind it — the same reason REPORTABLE_ORDER_STATUSES includes DRAFT
 * (checkReports.ts): the sheet on the supervisor's desk is routinely
 * ahead of the record. Orders do leave without a typed check-out, and
 * gear does come back early. A gate that cannot be passed would send that
 * sheet into a drawer, which is exactly the gap this surface exists to
 * close.
 *
 * So the block is a STOP, not a wall: the button is not the thing you
 * land on, the reason is stated in words, and the way through is one tap
 * that says out loud what the person is asserting ("it went out on
 * paper", "it came back early"). What that buys is the accident — nobody
 * checks in tomorrow's rental by tapping the row above the one they
 * meant.
 *
 * Pure: no prisma, no dates-from-now. The caller passes today's Pacific
 * ymd (pacificYmd(0)) so the rule is testable and reads the same on the
 * list, the sheet and the server.
 */

/** Statuses only a departure writes. LOADED_READY is deliberately NOT
 *  one of them — loaded on the truck is still in the building. */
const WENT_OUT_STATUSES: ReadonlySet<string> = new Set([
  'ON_JOB', 'RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED',
])

export type CheckInBlock = 'never-went-out' | 'not-due-back'

export interface CheckInFacts {
  /** Order.status. */
  status: string
  /** The order's end date as a Pacific ymd; null when it has no dates. */
  endYmd: string | null
  /** Today, Pacific — pacificYmd(0). */
  todayYmd: string
  /** A check-OUT report exists for this order, partial or complete. */
  outFiled: boolean
}

export interface CheckInReadiness {
  /** Nothing is in the way — "Begin Check In" is the primary action. */
  ready: boolean
  block: CheckInBlock | null
  /** What is in the way, in words the floor can act on. */
  reason: string | null
  /** The label of the tap that starts it anyway. It is phrased as the
   *  assertion the person is making, never as "continue". */
  override: string | null
}

const READY: CheckInReadiness = { ready: true, block: null, reason: null, override: null }

export function checkInReadiness(facts: CheckInFacts): CheckInReadiness {
  const wentOut = facts.outFiled || WENT_OUT_STATUSES.has(facts.status)
  if (!wentOut) {
    return {
      ready: false,
      block: 'never-went-out',
      reason:
        'Nothing has gone out on this order yet — there is no check-out sheet on file and the order has not left the yard.',
      override: 'It went out on paper — check it in anyway',
    }
  }
  // An order with no dates cannot be early. Undated orders are rare and
  // are usually the rush job typed at 6am; hold nothing over them.
  if (facts.endYmd && facts.endYmd > facts.todayYmd) {
    return {
      ready: false,
      block: 'not-due-back',
      reason: 'This order is not due back yet — only start the check-in once the gear is physically back in the yard.',
      override: 'It came back early — start the check-in',
    }
  }
  return READY
}
