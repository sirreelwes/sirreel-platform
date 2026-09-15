/**
 * What a check-IN sheet says did not come back — the pure half, shared by
 * the L&D composer and the "L&D reported" email so they can never disagree.
 *
 * The trap this exists for: `classifyCheckLine` calls a line with NOTHING
 * back (0 of 3) `REMOVED`, not `SHORT` — the word is written for the OUT
 * edge, where it means "taken off the order". On the IN edge it is the
 * worst shortfall there is, and the composer's first cut filtered on
 * `SHORT` alone, so three stingers that never came back were invisible
 * while one of three would have listed.
 *
 * No prisma here — the test imports it directly.
 */

import type { OrderCheckLineChange } from '@prisma/client'

export interface InboundLineFacts {
  orderLineItemId: string | null
  description: string
  expectedQty: number
  actualQty: number
  change: OrderCheckLineChange
  /** Absent on older rows; false = this pass did not count the line. */
  onSheet?: boolean
  note?: string | null
}

export interface MissingGear {
  orderLineItemId: string
  description: string
  expectedQty: number
  actualQty: number
  missing: number
  note: string | null
}

/**
 * Lines the inbound sheet counted short. An ADDED row (never on the order)
 * cannot be missing, an off-sheet line was not counted at all, and a
 * SUBSTITUTE says something else came back in its place — none of those is
 * a loss.
 */
export function missingOnCheckIn(lines: InboundLineFacts[]): MissingGear[] {
  const out: MissingGear[] = []
  for (const l of lines) {
    if (!l.orderLineItemId) continue
    if (l.onSheet === false) continue
    if (l.change !== 'SHORT' && l.change !== 'REMOVED') continue
    if (l.actualQty >= l.expectedQty) continue
    out.push({
      orderLineItemId: l.orderLineItemId,
      description: l.description,
      expectedQty: l.expectedQty,
      actualQty: l.actualQty,
      missing: l.expectedQty - l.actualQty,
      note: l.note?.trim() || null,
    })
  }
  return out
}

export interface MissingGearDelta {
  /** Short now and not (or less) short on the sheet as it stood before. */
  newlyMissing: MissingGear[]
  /** Short before, fewer (or none) missing now — the piece turned up. */
  turnedUp: Array<{ description: string; wasMissing: number; nowMissing: number }>
}

/**
 * The sheet is replaced in place on every pass and every correction, so the
 * email must say what CHANGED — not re-announce the same missing light each
 * time someone saves the rest of the check-in.
 */
export function diffMissingGear(before: InboundLineFacts[], after: InboundLineFacts[]): MissingGearDelta {
  const prev = new Map(missingOnCheckIn(before).map((m) => [m.orderLineItemId, m]))
  const next = new Map(missingOnCheckIn(after).map((m) => [m.orderLineItemId, m]))

  const newlyMissing: MissingGear[] = []
  for (const m of Array.from(next.values())) {
    const was = prev.get(m.orderLineItemId)?.missing ?? 0
    if (m.missing > was) newlyMissing.push(m)
  }

  const turnedUp: MissingGearDelta['turnedUp'] = []
  for (const m of Array.from(prev.values())) {
    const now = next.get(m.orderLineItemId)
    // A line that dropped off the sheet entirely (off-sheet on this pass)
    // was not re-counted, so it has not turned up — it is simply silent.
    const stillCounted = after.some((l) => l.orderLineItemId === m.orderLineItemId && l.onSheet !== false)
    if (!stillCounted) continue
    const nowMissing = now?.missing ?? 0
    if (nowMissing < m.missing) {
      turnedUp.push({ description: now?.description ?? m.description, wasMissing: m.missing, nowMissing })
    }
  }

  return { newlyMissing, turnedUp }
}
