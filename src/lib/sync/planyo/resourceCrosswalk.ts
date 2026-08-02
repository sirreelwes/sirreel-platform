/**
 * Build the planyoResourceId → AssetCategory map once per run.
 * Lines whose resource_id is missing here are flagged FLAG_UNMAPPED,
 * never silently dropped or auto-mapped.
 */

import type { PrismaClient } from '@prisma/client'

export interface CrosswalkEntry {
  /**
   * AssetCategory id. Still the scheduling subsystem's unit-of-work key
   * and the target of BookingItem.categoryId, which is NOT NULL with an
   * FK to asset_categories — new Planyo holds must keep supplying it.
   */
  id: string
  /** Merged catalog row, written to BookingItem.catalogItemId. */
  catalogItemId: string
  name: string
  dailyRate: number
}

export async function buildResourceCrosswalk(
  prisma: PrismaClient,
): Promise<Map<number, CrosswalkEntry>> {
  // Name and rate come off the MERGED row — the AssetCategory copy is
  // frozen, so a Planyo hold built from it would carry a price that went
  // stale the moment someone edited the catalog.
  const rows = await prisma.inventoryItem.findMany({
    where: { planyoResourceId: { not: null } },
    select: {
      id: true,
      code: true,
      description: true,
      dailyRate: true,
      planyoResourceId: true,
      legacyAssetCategoryId: true,
    },
  })
  const m = new Map<number, CrosswalkEntry>()
  for (const r of rows) {
    if (r.planyoResourceId == null) continue
    // A catalog row minted after the merge has no AssetCategory to anchor
    // BookingItem.categoryId to. Leave it unmapped rather than fail the
    // whole sync — the caller already treats a missing resource as
    // FLAG_UNMAPPED and surfaces it.
    if (!r.legacyAssetCategoryId) continue
    m.set(r.planyoResourceId, {
      id: r.legacyAssetCategoryId,
      catalogItemId: r.id,
      name: r.description || r.code,
      dailyRate: Number(r.dailyRate),
    })
  }
  return m
}
