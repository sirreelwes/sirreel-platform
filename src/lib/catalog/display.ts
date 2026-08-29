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

/**
 * The item code a CLIENT may see, or null when there isn't a real one.
 *
 * Same rule as `catalogInvoiceLabel`, for the surfaces that print a bare
 * code in its own column rather than a label: a UNIT_TRACKED row's
 * `code` is the synthetic CAT_* slug minted during the merge, so a quote
 * line reading "Cargo w/Lift Gate — CAT_CARGO_VAN_LIFTGATE" is the merge
 * leaking into a client document. Blank is right there: the description
 * column already names the thing, and the label variant would only
 * repeat it.
 *
 * Warehouse gear keeps its stock code — clients have always seen those
 * and match them against their own paperwork.
 */
export function catalogClientCode(li: {
  inventoryItem?: {
    code?: string | null
    rwICode?: string | null
    trackingMode?: string | null
  } | null
}): string | null {
  const inv = li.inventoryItem
  if (!inv) return null
  if (inv.trackingMode === 'UNIT_TRACKED') return null
  // The RentalWorks I-Code first. That's the number the client has on
  // every piece of paper we've sent them for years, and 1,204 of the
  // 1,746 active catalog rows carry one (backfilled in the 2026-06-23
  // reconcile). This surface was printing `code` instead — HQ's own
  // descriptive unique key — so two thirds of the imported I-Codes never
  // reached a client document.
  if (inv.rwICode) return inv.rwICode
  // No I-Code: `code` is only worth printing when it looks like a
  // catalog number. On HQ-native rows it's a descriptive slug
  // ("TAB-DIRECTORS-CHAIRS-LOW") that means nothing outside this
  // database, and the description column already names the item.
  const code = inv.code ?? null
  return code && /^[0-9][0-9A-Za-z._/-]*$/.test(code) ? code : null
}
