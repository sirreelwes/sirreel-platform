/**
 * The red flag — a line the WAREHOUSE changed at pickup.
 *
 * Wes, 2026-09-12: "On RW when they add or swap something, we can see a
 * little red flag by the item on the order to denote this item was added
 * or swapped by warehouse at the time of pickup. The client doesn't see
 * this red flag, nor should they."
 *
 * The fact lives on the line (OrderLineItem.warehouseChange + At / ById /
 * From) and is written by ONE path: the check-out report. This module is
 * the vocabulary — the two kinds and the sentence the flag's tooltip
 * says — with no prisma import, so the order page (a client component)
 * can read it. Which surfaces may show it is the other half of the rule:
 * STAFF ONLY. The portal, the quote PDF and the invoice PDF map lines
 * field by field and must never pick these up.
 */

export const WAREHOUSE_CHANGE_KINDS = ['ADDED', 'SWAPPED'] as const
export type WarehouseChangeKind = (typeof WAREHOUSE_CHANGE_KINDS)[number]

export function isWarehouseChangeKind(v: unknown): v is WarehouseChangeKind {
  return v === 'ADDED' || v === 'SWAPPED'
}

export interface WarehouseChangeFacts {
  warehouseChange?: string | null
  warehouseChangeAt?: string | Date | null
  /** For SWAPPED: what the line said before the dock exchanged it. */
  warehouseChangeFrom?: string | null
}

const fmtDay = (d: string | Date) => {
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return null
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })
}

/** The tooltip on the flag, or null when the line carries no flag. */
export function describeWarehouseChange(line: WarehouseChangeFacts): string | null {
  if (!isWarehouseChangeKind(line.warehouseChange)) return null
  const when = line.warehouseChangeAt ? fmtDay(line.warehouseChangeAt) : null
  const at = when ? ` on ${when}` : ''
  if (line.warehouseChange === 'ADDED') {
    return `Added by the warehouse at pickup${at} — not on the order the client approved. Check the rate.`
  }
  const from = line.warehouseChangeFrom?.trim()
  return from
    ? `Swapped by the warehouse at pickup${at} — was "${from}". Rate carried over; check it fits.`
    : `Swapped by the warehouse at pickup${at}. Rate carried over; check it fits.`
}
