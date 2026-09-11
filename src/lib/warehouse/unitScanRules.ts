import type { ScanResolution } from '@/lib/warehouse/resolveScan'

/**
 * What a scan at the check-out / check-in desk MEANS — barcode phase 3.
 *
 * Pure: no Prisma, no clock. `recordUnitScan` (unitScans.ts) loads the
 * order, the unit's open rows and the resolution, hands them here, and
 * executes whatever comes back. Keeping the decision out of the DB code
 * is what lets `npm run test:unit-scans` pin every outcome offline, and
 * every outcome matters at the dock:
 *
 *   - Too strict and the supervisor abandons the scanner ("it keeps
 *     saying no") and goes back to counting by eye — which is the
 *     problem this exists to fix.
 *   - Too loose and a walkie is recorded on the wrong order, and the
 *     next time it is scanned it is "still out on S260910-002" to a
 *     crew that never had it.
 *
 * So every refusal names WHY and says whether an override exists, and
 * the overrides are explicit flags the screen has to send back, never
 * something the resolver infers.
 */

export type ScanEdge = 'OUT' | 'IN'

/** An order line as the rules see it. */
export interface ScanLine {
  orderLineItemId: string
  inventoryItemId: string | null
  description: string
  quantity: number
  sortOrder: number
}

/** A live (non-voided) OrderUnitScan row, on this order or another. */
export interface LiveScan {
  id: string
  orderId: string
  orderNumber: string
  orderLineItemId: string | null
  inventoryUnitId: string
  barcode: string
  outScannedAt: Date | null
  inScannedAt: Date | null
}

/** The unit is out and has not come back, on whatever order. */
export function isOpen(s: Pick<LiveScan, 'outScannedAt' | 'inScannedAt'>): boolean {
  return !!s.outScannedAt && !s.inScannedAt
}

export type RefuseCode =
  | 'unknown'
  | 'not-a-unit'
  | 'unlinked-unit'
  | 'out-elsewhere'
  | 'line-full'
  | 'not-on-order'
  | 'not-out'

export interface Refusal {
  kind: 'refuse'
  code: RefuseCode
  reason: string
  /** Which flag re-sending the same scan with would go through. */
  override: 'allowOver' | 'closeOpen' | null
  /** For out-elsewhere: the order holding the unit. */
  openOn?: { orderId: string; orderNumber: string; scanId: string }
}

export type OutDecision =
  | {
      kind: 'attach'
      orderLineItemId: string | null
      /** Beyond the line's quantity, or on no line at all. */
      over: boolean
      /** Close this open row (another order) as an implied return first. */
      closeScanId: string | null
      closeOnOrderNumber: string | null
      /** Position on the line after this scan, e.g. 3 of 6. */
      position: { n: number; of: number } | null
    }
  | { kind: 'duplicate'; scanId: string; position: { n: number; of: number } | null }
  | Refusal

export type InDecision =
  | { kind: 'close'; scanId: string; onOrderNumber: string; onThisOrder: boolean }
  | {
      /** Came back without ever being scanned out. Recorded, not refused —
       *  the IN scan is the more valuable of the two. */
      kind: 'attach-in'
      orderLineItemId: string | null
    }
  | { kind: 'duplicate'; scanId: string }
  | Refusal

export interface DecideContext {
  lines: ScanLine[]
  /** Live rows on THIS order (any unit). */
  thisOrder: LiveScan[]
  /** The unit's open row on ANOTHER order, if any. */
  openElsewhere: LiveScan | null
  allowOver?: boolean
  closeOpen?: boolean
}

function unitLabel(res: Extract<ScanResolution, { kind: 'unit' }>): string {
  return res.unit.description ? `${res.scanned} (${res.unit.description})` : res.scanned
}

/** The refusals shared by both edges: the scan did not name a unit. */
function refuseNonUnit(res: ScanResolution): Refusal | null {
  if (res.kind === 'unknown') {
    return {
      kind: 'refuse',
      code: 'unknown',
      reason: `${res.scanned || 'That'} isn't a barcode we know. Check the label — or count the line by hand.`,
      override: null,
    }
  }
  if (res.kind === 'catalog') {
    return {
      kind: 'refuse',
      code: 'not-a-unit',
      reason: `${res.scanned} is the catalog code for the product, not a unit label. Scan the SR barcode on the piece itself.`,
      override: null,
    }
  }
  if (res.kind === 'unlinked-unit') {
    return {
      kind: 'refuse',
      code: 'unlinked-unit',
      reason: `${res.scanned} is ${res.unit.description ?? 'a known unit'} (RW item ${res.unit.rwICode}), but it isn't matched to anything in the HQ catalog yet — count the line by hand and flag the item.`,
      override: null,
    }
  }
  return null
}

/** Lines that carry this unit's catalog row, in order. */
function matchingLines(lines: ScanLine[], inventoryItemId: string): ScanLine[] {
  return lines
    .filter((l) => l.inventoryItemId === inventoryItemId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

function outCountOn(scans: LiveScan[], lineId: string): number {
  return scans.filter((s) => s.orderLineItemId === lineId && !!s.outScannedAt).length
}

export function decideOut(res: ScanResolution, ctx: DecideContext): OutDecision {
  const nonUnit = refuseNonUnit(res)
  if (nonUnit) return nonUnit
  if (res.kind !== 'unit') throw new Error('unreachable')

  // Same unit already open on this order — a double read, or a second
  // pass over a shelf. Not an error; the screen says "already counted".
  const openHere = ctx.thisOrder.find((s) => s.inventoryUnitId === res.unit.id && isOpen(s))
  if (openHere) {
    const line = openHere.orderLineItemId
      ? ctx.lines.find((l) => l.orderLineItemId === openHere.orderLineItemId)
      : null
    return {
      kind: 'duplicate',
      scanId: openHere.id,
      position: line ? { n: outCountOn(ctx.thisOrder, line.orderLineItemId), of: line.quantity } : null,
    }
  }

  // Open on another order: it never came back through a scanner. The
  // supervisor decides — "mark it back from there" closes that row as
  // an IMPLIED return and sends it out here.
  let closeScanId: string | null = null
  let closeOnOrderNumber: string | null = null
  if (ctx.openElsewhere) {
    if (!ctx.closeOpen) {
      return {
        kind: 'refuse',
        code: 'out-elsewhere',
        reason: `${unitLabel(res)} is still out on ${ctx.openElsewhere.orderNumber}. Mark it back from that order first, or use the button to do both at once.`,
        override: 'closeOpen',
        openOn: {
          orderId: ctx.openElsewhere.orderId,
          orderNumber: ctx.openElsewhere.orderNumber,
          scanId: ctx.openElsewhere.id,
        },
      }
    }
    closeScanId = ctx.openElsewhere.id
    closeOnOrderNumber = ctx.openElsewhere.orderNumber
  }

  const candidates = matchingLines(ctx.lines, res.inventoryItemId)
  const withRoom = candidates.find((l) => outCountOn(ctx.thisOrder, l.orderLineItemId) < l.quantity)
  if (withRoom) {
    return {
      kind: 'attach',
      orderLineItemId: withRoom.orderLineItemId,
      over: false,
      closeScanId,
      closeOnOrderNumber,
      position: { n: outCountOn(ctx.thisOrder, withRoom.orderLineItemId) + 1, of: withRoom.quantity },
    }
  }

  if (candidates.length) {
    const first = candidates[0]
    if (ctx.allowOver) {
      return {
        kind: 'attach',
        orderLineItemId: first.orderLineItemId,
        over: true,
        closeScanId,
        closeOnOrderNumber,
        position: { n: outCountOn(ctx.thisOrder, first.orderLineItemId) + 1, of: first.quantity },
      }
    }
    const total = candidates.reduce((n, l) => n + l.quantity, 0)
    return {
      kind: 'refuse',
      code: 'line-full',
      reason: `All ${total} ${first.description} on this order are already scanned. Add ${res.scanned} anyway if it's really going — the order will change.`,
      override: 'allowOver',
    }
  }

  if (ctx.allowOver) {
    return {
      kind: 'attach',
      orderLineItemId: null,
      over: true,
      closeScanId,
      closeOnOrderNumber,
      position: null,
    }
  }
  return {
    kind: 'refuse',
    code: 'not-on-order',
    reason: `${unitLabel(res)} isn't on this order. Send it anyway if it's really going — it will show as an addition for the agent to price.`,
    override: 'allowOver',
  }
}

export function decideIn(res: ScanResolution, ctx: DecideContext): InDecision {
  const nonUnit = refuseNonUnit(res)
  if (nonUnit) return nonUnit
  if (res.kind !== 'unit') throw new Error('unreachable')

  const mine = ctx.thisOrder.filter((s) => s.inventoryUnitId === res.unit.id)
  const openHere = mine.find(isOpen)
  if (openHere) {
    return { kind: 'close', scanId: openHere.id, onOrderNumber: '', onThisOrder: true }
  }

  if (ctx.openElsewhere) {
    if (ctx.closeOpen) {
      return {
        kind: 'close',
        scanId: ctx.openElsewhere.id,
        onOrderNumber: ctx.openElsewhere.orderNumber,
        onThisOrder: false,
      }
    }
    return {
      kind: 'refuse',
      code: 'out-elsewhere',
      reason: `${unitLabel(res)} went out on ${ctx.openElsewhere.orderNumber}, not this order. Use the button to mark it back from there.`,
      override: 'closeOpen',
      openOn: {
        orderId: ctx.openElsewhere.orderId,
        orderNumber: ctx.openElsewhere.orderNumber,
        scanId: ctx.openElsewhere.id,
      },
    }
  }

  // Already back on this order (a double read at the return bench).
  const back = mine.find((s) => !!s.inScannedAt)
  if (back) return { kind: 'duplicate', scanId: back.id }

  // Never scanned out anywhere — paper out, scanner in. Record it on
  // the matching line if there is one; it is still a return.
  const line = matchingLines(ctx.lines, res.inventoryItemId)[0] ?? null
  return { kind: 'attach-in', orderLineItemId: line?.orderLineItemId ?? null }
}

// ── Summary for the report screen ────────────────────────────────────

export interface UnitScanUnit {
  scanId: string
  barcode: string
  description: string | null
  outAt: string | null
  inAt: string | null
  inImplied: boolean
}

export interface LineUnitSummary {
  orderLineItemId: string
  /** Units scanned OUT on this line (open or completed). */
  out: number
  /** Units scanned IN on this line. */
  back: number
  /** Out and not back. */
  stillOut: number
  units: UnitScanUnit[]
}

export interface UnitScanSummary {
  lines: LineUnitSummary[]
  /** Scanned on this order but attached to no line. */
  unlisted: UnitScanUnit[]
  totalOut: number
  totalBack: number
}

export interface SummaryRow {
  id: string
  orderLineItemId: string | null
  barcode: string
  description: string | null
  outScannedAt: Date | null
  inScannedAt: Date | null
  inImplied: boolean
}

export function summarizeUnitScans(lineIds: string[], rows: SummaryRow[]): UnitScanSummary {
  const toUnit = (r: SummaryRow): UnitScanUnit => ({
    scanId: r.id,
    barcode: r.barcode,
    description: r.description,
    outAt: r.outScannedAt ? r.outScannedAt.toISOString() : null,
    inAt: r.inScannedAt ? r.inScannedAt.toISOString() : null,
    inImplied: r.inImplied,
  })
  const byLine = new Map<string, SummaryRow[]>()
  const unlisted: SummaryRow[] = []
  for (const r of rows) {
    if (r.orderLineItemId && lineIds.includes(r.orderLineItemId)) {
      const arr = byLine.get(r.orderLineItemId) ?? []
      arr.push(r)
      byLine.set(r.orderLineItemId, arr)
    } else {
      unlisted.push(r)
    }
  }
  const lines: LineUnitSummary[] = lineIds
    .filter((id) => byLine.has(id))
    .map((id) => {
      const rs = byLine.get(id)!
      const out = rs.filter((r) => !!r.outScannedAt).length
      const back = rs.filter((r) => !!r.inScannedAt).length
      return {
        orderLineItemId: id,
        out,
        back,
        stillOut: rs.filter(isOpen).length,
        units: rs.map(toUnit),
      }
    })
  return {
    lines,
    unlisted: unlisted.map(toUnit),
    totalOut: rows.filter((r) => !!r.outScannedAt).length,
    totalBack: rows.filter((r) => !!r.inScannedAt).length,
  }
}
