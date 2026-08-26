/**
 * Legacy-id resolution for the unified catalog.
 *
 * The Aug 2026 merge folded AssetCategory into InventoryItem: one catalog
 * model, with `trackingMode` recording whether availability comes from
 * individually-identified Assets (UNIT_TRACKED) or a count on hand
 * (QUANTITY). The AssetCategory rows are still present and still carry
 * their original values — nothing was dropped — but they are FROZEN.
 *
 * That last part is the whole point of this file: rates and catalog
 * details are edited on InventoryItem now, so any reader that still does
 * `assetCategory.dailyRate` will quietly serve a price that stopped being
 * true the first time someone edits the merged row. Callers holding a
 * legacy assetCategoryId — order lines written before the merge, the
 * Planyo resource crosswalk, public vehicle pages — must translate it
 * here rather than reading the old table.
 */
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export type Db = Prisma.TransactionClient | typeof prisma

/**
 * Translate a legacy AssetCategory id to the merged catalog row's id.
 * Returns null when the id has no merged counterpart (which would mean an
 * AssetCategory created after the merge — see the Phase 5 write guard).
 */
export async function catalogIdForAssetCategory(
  assetCategoryId: string,
  db: Db = prisma,
): Promise<string | null> {
  const row = await db.inventoryItem.findUnique({
    where: { legacyAssetCategoryId: assetCategoryId },
    select: { id: true },
  })
  return row?.id ?? null
}

/**
 * Normalize any catalog reference to a single InventoryItem id.
 *
 * An explicit inventoryItemId always wins — post-merge writes set it
 * directly. A legacy assetCategoryId is translated. Returns null when
 * neither is present or resolvable, which callers should treat exactly as
 * they treated "no catalog link" before the merge.
 */
export async function normalizeCatalogRef(
  ref: { inventoryItemId?: string | null; assetCategoryId?: string | null },
  db: Db = prisma,
): Promise<string | null> {
  if (ref.inventoryItemId) return ref.inventoryItemId
  if (ref.assetCategoryId) return catalogIdForAssetCategory(ref.assetCategoryId, db)
  return null
}

/**
 * Batch form for list endpoints — one query instead of N. Returns a Map
 * keyed by legacy AssetCategory id.
 */
export async function catalogIdsForAssetCategories(
  assetCategoryIds: string[],
  db: Db = prisma,
): Promise<Map<string, string>> {
  const ids = [...new Set(assetCategoryIds.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const rows = await db.inventoryItem.findMany({
    where: { legacyAssetCategoryId: { in: ids } },
    select: { id: true, legacyAssetCategoryId: true },
  })
  return new Map(rows.map((r) => [r.legacyAssetCategoryId as string, r.id]))
}

/**
 * INVERSE of `catalogIdForAssetCategory` — normalize any catalog reference to
 * the id the SCHEDULER speaks.
 *
 * Availability, holds and `BookingItem.categoryId` are all keyed on the legacy
 * AssetCategory id (that FK is NOT NULL and still points at the frozen table).
 * But every post-merge catalog surface — `parse-quote`'s `matchedProduct.id`,
 * the catalog matcher, anything reading InventoryItem — hands out the MERGED
 * row's id. Handing one of those straight to the scheduler silently matches
 * zero Assets: `getCategoryAvailability` reports `0 of 0` and the hold POST
 * 404s "category not found".
 *
 * Idempotent by construction: an id that isn't an InventoryItem is passed
 * through untouched, so callers already in the AssetCategory id space (the
 * gantt picker, `/api/scheduling/categories`) are unaffected. An InventoryItem
 * with no legacy counterpart (QUANTITY-tracked — never unit-scheduled) also
 * passes through, and fails downstream exactly as it did before.
 */
export async function schedulingCategoryId(
  catalogId: string,
  db: Db = prisma,
): Promise<string> {
  const row = await db.inventoryItem.findUnique({
    where: { id: catalogId },
    select: { legacyAssetCategoryId: true },
  })
  return row?.legacyAssetCategoryId ?? catalogId
}
