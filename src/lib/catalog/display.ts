/**
 * Display helpers for the unified catalog.
 *
 * Before the Aug 2026 merge, "does this line have an assetCategory?" was
 * how the codebase asked "is this a vehicle or a stage, rather than a
 * piece of warehouse gear?" Both are InventoryItems now, so that question
 * is answered by `trackingMode` — UNIT_TRACKED is what used to be an
 * AssetCategory.
 *
 * Reading the answer off the presence of an inventoryItem instead would
 * silently change behaviour: every warehouse line has one, and those
 * lines used to report no category at all.
 */

/** Rows selected with enough of the catalog joined to name a category. */
export interface LineWithCatalog {
  inventoryItem?: {
    description?: string | null
    trackingMode?: string | null
  } | null
}

/**
 * The category name for a line, or null for warehouse gear — matching
 * what `assetCategory?.name` returned before the merge.
 */
export function categoryNameForLine(li: LineWithCatalog): string | null {
  if (li.inventoryItem?.trackingMode !== 'UNIT_TRACKED') return null
  return li.inventoryItem.description ?? null
}

/** True when a line is backed by a unit-tracked catalog row. */
export function isUnitTrackedLine(li: LineWithCatalog): boolean {
  return li.inventoryItem?.trackingMode === 'UNIT_TRACKED'
}

/**
 * The label a line shows on a CLIENT-FACING invoice.
 *
 * Warehouse gear labels by its stock code, which is what clients have
 * always seen. A unit-tracked row labels by name: its `code` is a
 * synthetic CAT_* slug minted during the merge purely to satisfy the
 * unique constraint, and putting "CAT_CUBE_TRUCK" on an invoice where
 * "SuperCube Truck" used to appear would be a visible regression.
 */
export function catalogInvoiceLabel(li: {
  inventoryItem?: {
    code?: string | null
    description?: string | null
    trackingMode?: string | null
  } | null
}): string | null {
  const inv = li.inventoryItem
  if (!inv) return null
  if (inv.trackingMode === 'UNIT_TRACKED') return inv.description ?? inv.code ?? null
  return inv.code ?? inv.description ?? null
}
