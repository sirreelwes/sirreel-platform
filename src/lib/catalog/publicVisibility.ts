/**
 * The public-catalog gate — one definition, used by every surface.
 *
 * An inventory item reaches a client only when ALL of these hold:
 *   1. isActive            — not archived
 *   2. categoryId != null  — the order form has somewhere to put it
 *   3. a real price        — dailyRate > 0, OR includedFree (renders
 *                            "Included", not orderable)
 *   4. publicVisible       — someone decided to publish it
 *
 * Rule 3 is the fail-safe: a $0 rate with no `includedFree` is a MISSING
 * price, and showing it would read as "FREE" to a client. It stays hidden
 * even when published.
 *
 * Before this module the rule lived inline in three places (the public
 * catalog route, the site-wide search index, and the publish desk's own
 * counts). They agreed by luck. Now the desk can promise "flip this and
 * the client sees it" because it is reading the same predicate the
 * client-facing routes read.
 */

import type { Prisma } from '@prisma/client'

/** Rules 1, 2 and 4 as a Prisma filter. Rule 3 needs a row, see below. */
export const PUBLIC_CATALOG_VISIBLE_WHERE = {
  publicVisible: true,
  isActive: true,
  categoryId: { not: null },
} satisfies Prisma.InventoryItemWhereInput

/** Rules 1 and 2 only — every row the publish desk can act on. */
export const PUBLISHABLE_CANDIDATE_WHERE = {
  isActive: true,
  categoryId: { not: null },
} satisfies Prisma.InventoryItemWhereInput

/** The minimum a row needs for the gate to be decidable. */
export interface GateRow {
  isActive: boolean
  categoryId: string | null
  dailyRate: unknown // Prisma.Decimal | number | string
  includedFree: boolean
  publicVisible: boolean
}

/** Rule 3. `Number()` handles Decimal, string and number alike. */
export function hasPublicPrice(row: Pick<GateRow, 'dailyRate' | 'includedFree'>): boolean {
  return Number(row.dailyRate) > 0 || row.includedFree
}

export type PublicBlockReason = 'inactive' | 'no-category' | 'no-price' | 'not-public'

/**
 * Why this row is NOT client-visible, or null when it is. Ordered so the
 * reason returned is the one to fix FIRST — publishing an item with no
 * price changes nothing a client can see.
 */
export function publicBlockReason(row: GateRow): PublicBlockReason | null {
  if (!row.isActive) return 'inactive'
  if (!row.categoryId) return 'no-category'
  if (!hasPublicPrice(row)) return 'no-price'
  if (!row.publicVisible) return 'not-public'
  return null
}

/** Would flipping publicVisible alone put this in front of a client? */
export function publishingIsEnough(row: GateRow): boolean {
  return row.isActive && !!row.categoryId && hasPublicPrice(row)
}

export const BLOCK_REASON_LABEL: Record<PublicBlockReason, string> = {
  inactive: 'Archived',
  'no-category': 'No category',
  'no-price': 'No price',
  'not-public': 'Hidden',
}
