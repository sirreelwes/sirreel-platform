/**
 * What a marked-up pull sheet MEANS — the pure half of the check report.
 *
 * Split out of checkReports.ts (which imports prisma) so the supervisor's
 * screen can classify and describe a difference with the SAME code that
 * writes it. Before this, the form knew only how many lines differed and
 * the server alone knew what that would do; the confirm step Wes asked
 * for on 2026-09-04 has to read the change back in the exact words that
 * land in the audit row, the agent's flag and the client's re-sent quote,
 * and two copies of that wording would drift the first time either moved.
 *
 * Nothing here touches the database or the session. Keep it that way —
 * it is imported by a client component.
 */

import type { OrderCheckLineChange } from '@prisma/client'

/** The shape both sides classify: a line as the sheet left it. */
export interface CheckLineFacts {
  /** null for a row that was never on the order. */
  orderLineItemId: string | null
  description: string
  expectedQty: number
  actualQty: number
  substituteFor?: string | null
}

/** What kind of difference this row records. Derived, never trusted from
 *  the client — the classification drives what we write to the order.
 *  Exported for the test: this function decides whether a client gets
 *  billed differently, and the order of its branches is load-bearing. */
export function classifyCheckLine(line: CheckLineFacts): OrderCheckLineChange {
  if (!line.orderLineItemId) return 'ADDED'
  if (line.substituteFor && line.substituteFor.trim()) return 'SUBSTITUTE'
  if (line.actualQty === 0 && line.expectedQty > 0) return 'REMOVED'
  if (line.actualQty < line.expectedQty) return 'SHORT'
  if (line.actualQty > line.expectedQty) return 'EXTRA'
  return 'NONE'
}

/** The two sheets. Mirrors the Prisma enum without importing it — this
 *  file is loaded by a client component. */
export type SheetEdge = 'OUT' | 'IN'

/**
 * One line of plain English for one difference.
 *
 * Read aloud on the confirm step, stored on the audit row, shown to the
 * agent, and pasted into the client's corrected quote — one sentence,
 * one place.
 *
 * The inbound sheet says the same facts in return words: a zero on the
 * way out is "did not send", but a zero on the way back is "none of it
 * came back", and reading the first to a supervisor counting returns
 * (which the check-in screen did until 2026-09-12) makes them doubt the
 * number they just typed.
 */
export function describeCheckChange(
  line: CheckLineFacts,
  change: OrderCheckLineChange = classifyCheckLine(line),
  edge: SheetEdge = 'OUT',
): string {
  if (edge === 'IN') {
    switch (change) {
      case 'SUBSTITUTE': return `${line.substituteFor} → ${line.description} (×${line.actualQty} back)`
      case 'ADDED':      return `came back with ${line.description} ×${line.actualQty}`
      case 'REMOVED':    return `${line.description}: none of ${line.expectedQty} came back`
      case 'SHORT':
        return `${line.description}: ${line.actualQty} of ${line.expectedQty} back — ${line.expectedQty - line.actualQty} missing`
      default:           return `${line.description}: ${line.expectedQty} out, ${line.actualQty} back`
    }
  }
  switch (change) {
    case 'SUBSTITUTE': return `${line.substituteFor} → ${line.description} (×${line.actualQty})`
    case 'ADDED':      return `added ${line.description} ×${line.actualQty}`
    case 'REMOVED':    return `did not send ${line.description}`
    default:           return `${line.description}: ${line.expectedQty} → ${line.actualQty}`
  }
}

// ── Partial returns ──────────────────────────────────────────────────
//
// Oliver, 2026-09-12: "sometimes partial returns come back at different
// days along the rental and warehouse makes multiple check in contracts.
// Once they check in items on HQ and click submit, it removes the order
// from their check in tab. This means a partial return is going to look
// like the job is done and a whole bunch of stuff is missing."
//
// The sheet already knew a WHOLE line could be "still out" (off the
// sheet, Wes's partial pull of 2026-09-04). It did not know 5 of 10
// could be back — that filed as SHORT, which is "5 missing", and a sheet
// with no line left off it is complete, so it closed the pick list,
// stamped the job returned and moved the order to RETURNED. Exactly
// Oliver's sentence.
//
// So on the inbound edge an off-sheet line now CARRIES ITS COUNT: it is
// a line that has not finished coming back, and `actualQty` is how much
// of it is back so far. Every reader of "partial" downstream — the
// board's "N still out", the report list's chip, Ana's billing queue,
// settleGearAfterReport's early return — keys on onSheet/partial and so
// already treats it correctly. The outbound edge is untouched: a line
// left off a pull still records nothing about itself.

export interface SheetLineInput extends CheckLineFacts {
  /** False = the line is not (fully) on this sheet. See settleSheetLine. */
  onSheet?: boolean
}

/**
 * What a line on a filed sheet MEANS, per edge — the normalisation the
 * server writes and the form's read-back reflects. Never trusts the
 * client for anything but the count and the flag.
 *
 *   OUT, off the sheet → untouched: actual = expected, change NONE.
 *     The line stayed on the shelf; a zero here would rewrite the order
 *     and email the client a smaller quote.
 *   IN, off the sheet  → still coming back: actual = what is back so far
 *     (0 when nothing is), change NONE. Never classified, so it is never
 *     "short", never flagged, and never marks anything returned.
 *   IN, off the sheet with everything back → contradicts itself, so it
 *     is read as ON the sheet and classified normally. "All back but
 *     still out" is not a state; the form cannot send it, and a stray
 *     API caller should not be able to park a finished line open.
 *   On the sheet       → classified as before, on either edge.
 */
export function settleSheetLine(
  edge: SheetEdge,
  line: SheetLineInput,
): { actualQty: number; change: OrderCheckLineChange; onSheet: boolean } {
  const onSheet = line.onSheet !== false
  if (onSheet) return { actualQty: line.actualQty, change: classifyCheckLine(line), onSheet: true }
  if (edge === 'OUT') return { actualQty: line.expectedQty, change: 'NONE', onSheet: false }
  if (line.actualQty >= line.expectedQty) {
    return { actualQty: line.actualQty, change: classifyCheckLine(line), onSheet: true }
  }
  return { actualQty: Math.max(0, line.actualQty), change: 'NONE', onSheet: false }
}

/** "Walkie CP200: 5 of 10 back" — the running total on a line that is
 *  still coming back, for the notice, the done screen and the audit row. */
export function describeStillOut(line: Pick<CheckLineFacts, 'description' | 'expectedQty' | 'actualQty'>): string {
  return line.actualQty > 0
    ? `${line.description}: ${line.actualQty} of ${line.expectedQty} back`
    : `${line.description}: none of ${line.expectedQty} back yet`
}

/**
 * The form's half of the same rule: what a NEW count does to a row.
 *
 * A count that comes up short on the inbound edge is ambiguous — "5 of
 * 10" is either five back with five still on the truck, or five back
 * with five lost — and the two file very differently (one keeps the
 * order open, the other closes it and flags the agent). So the row does
 * not guess: `decided: false` means the supervisor has to say which,
 * and the form refuses to file until they have.
 *
 *   - a count that reaches the expected quantity is settled: all back.
 *   - a short count on a row that was ALREADY short and decided keeps
 *     its answer — bumping "3 of 10, still out" to 5 is more of the
 *     same, not a new question.
 *   - a short count on any other row asks.
 *   - the outbound edge never asks and never moves a line on or off the
 *     sheet: a short pull rewrites the order, which is what that sheet
 *     is for, and "not this pull" is its own button.
 */
export function countEdit(
  edge: SheetEdge,
  row: { expectedQty: number; actualQty: number; onSheet: boolean; decided: boolean },
  nextQty: number,
): { actualQty: number; onSheet: boolean; decided: boolean } {
  const actualQty = Math.max(0, nextQty)
  if (edge === 'OUT') return { actualQty, onSheet: row.onSheet, decided: true }
  if (actualQty >= row.expectedQty) return { actualQty, onSheet: true, decided: true }
  const wasShortAndDecided = row.actualQty < row.expectedQty && row.decided
  if (wasShortAndDecided) return { actualQty, onSheet: row.onSheet, decided: true }
  return { actualQty, onSheet: true, decided: false }
}
