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

/**
 * One line of plain English for one difference.
 *
 * Read aloud on the confirm step, stored on the audit row, shown to the
 * agent, and pasted into the client's corrected quote — one sentence,
 * one place.
 */
export function describeCheckChange(
  line: CheckLineFacts,
  change: OrderCheckLineChange = classifyCheckLine(line),
): string {
  switch (change) {
    case 'SUBSTITUTE': return `${line.substituteFor} → ${line.description} (×${line.actualQty})`
    case 'ADDED':      return `added ${line.description} ×${line.actualQty}`
    case 'REMOVED':    return `did not send ${line.description}`
    default:           return `${line.description}: ${line.expectedQty} → ${line.actualQty}`
  }
}
