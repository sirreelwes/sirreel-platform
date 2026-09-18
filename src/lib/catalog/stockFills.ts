/**
 * Rows the shelf holds that nobody orders by name.
 *
 * Some products are one thing to a client and several to the warehouse.
 * The client books "a walkie"; the shelf holds analog radios and digital
 * ones. The client books "a MiFi"; the shelf holds T-Mobile and Verizon
 * hotspots, and which one goes out is a coverage decision at the
 * location, not something a producer picks.
 *
 * Wes, 2026-09-15 (walkies): "From the client side, it should only look
 * like the Motorola CP200 … HQ manage[s] whether or not we need to
 * sublease." Wes, 2026-09-18 (MiFis): "We have MiFis that are T-Mobile
 * and Verizon. We keep both carriers to make sure we can provide when
 * there's an area with no coverage" — and then chose the same shape: one
 * orderable MiFi, the carriers as stock.
 *
 * ── Why the stock rows are not merged away ────────────────────────────
 * They are RentalWorks I-codes, and the nightly unit sync re-links every
 * barcoded unit to its row BY I-CODE (lib/rentalworks/syncInventoryUnits).
 * Folding one row into another would be undone by morning. So the stock
 * rows stay exactly as they are — counted, pullable, scannable — and the
 * ORDERING side is collapsed instead:
 *
 *   - the order row is the only one any picker, matcher, search or client
 *     surface offers (`NOT_STOCK_ONLY_WHERE`);
 *   - a scan of a stock unit resolves to the order row, so it lands on
 *     the line whichever one the floor grabbed (lib/warehouse/resolveScan);
 *   - a line on the order row counts as scannable when any row in its
 *     family has barcoded units (lib/warehouse/unitScans).
 *
 * Codes, not ids or names — names drift, and ids differ per environment.
 * This file is pure: no prisma, no env.
 */

export interface StockFill {
  /** `InventoryItem.code` of the row the shelf holds. */
  stock: string
  /** `InventoryItem.code` of the row orders are written against. */
  order: string
  /** What it is, in the words the yard would use. */
  what: string
}

export const STOCK_FILLS: readonly StockFill[] = [
  { stock: '103733', order: '104387', what: 'analog CP200 radios fill Motorola CP200 orders' },
  {
    stock: '104402',
    order: 'COM-MOBILE-INTERNET-MIFI',
    what: 'Verizon MiFis fill Mobile Internet MiFi orders',
  },
  {
    stock: '105020',
    order: 'COM-MOBILE-INTERNET-MIFI',
    what: 'T-Mobile MiFis fill Mobile Internet MiFi orders',
  },
]

/** Every row that is stock only — never offered, always countable. */
export const STOCK_ONLY_CODES: readonly string[] = STOCK_FILLS.map((f) => f.stock)

export function isStockOnlyCode(code: string | null | undefined): boolean {
  return !!code && STOCK_ONLY_CODES.includes(code)
}

/** The row a stock-only code's units should answer as. Null when the
 *  code is not stock-only — the caller keeps the row it has. */
export function orderCodeForStockCode(code: string | null | undefined): string | null {
  if (!code) return null
  return STOCK_FILLS.find((f) => f.stock === code)?.order ?? null
}

/** The stock rows that fill this order row. Empty for most products. */
export function stockCodesFor(orderCode: string | null | undefined): string[] {
  if (!orderCode) return []
  return STOCK_FILLS.filter((f) => f.order === orderCode).map((f) => f.stock)
}

/**
 * Every row whose units belong to this product — the order row plus its
 * stock. Pass an order code; a stock code returns just itself, since
 * nothing fills a stock row.
 */
export function familyCodes(orderCode: string | null | undefined): string[] {
  if (!orderCode) return []
  return [orderCode, ...stockCodesFor(orderCode)]
}

/**
 * Prisma filter fragment: leave the stock-only rows out. Spread into any
 * `inventoryItem` where clause that feeds an ordering or client surface.
 * Uses `NOT`, so a caller that already sets `NOT` must merge by hand.
 */
export const NOT_STOCK_ONLY_WHERE = {
  NOT: { code: { in: [...STOCK_ONLY_CODES] } },
} as const
