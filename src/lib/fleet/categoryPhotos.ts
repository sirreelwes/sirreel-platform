/**
 * The class photo for a reserved unit, keyed on its AssetCategory.
 *
 * One derivation, two surfaces. The client's job portal has shown a picture
 * of every truck they are getting since 2026-09-12 ("possibly with little
 * icon pictures of the vehicles" — Wes); HQ's own job page showed the same
 * reservations as text-only tiles until 2026-09-18, when Wes asked for the
 * staff page to mimic the portal. Both now read this, so a photo can never
 * mean one thing to the client and another to the rep.
 *
 * The lookup goes AssetCategory → VehicleCategory (`assetCategoryId`) and
 * hands back the public image proxy's href, because that proxy is what can
 * actually serve the bytes: the stored URLs are PRIVATE blobs that 403 on a
 * direct fetch. `PUBLIC_VEHICLE_VISIBLE_WHERE` is therefore not an editorial
 * choice here — it is the same gate the proxy enforces, so anything it
 * excludes would render a broken image. It also already means "has an
 * image", from any of the three sources (gallery photo, the row's own
 * `photoUrl`, or the linked Fleet Pricing item's) — do NOT hand-roll that
 * test: no live VehicleCategory has either of the first two, so a check of
 * those alone returns nothing but grey placeholders.
 *
 * Measured against every live booking 2026-09-18: 8 of the 9 reserved
 * classes resolve a photo. Lankershim Studios is the one that does not —
 * it is a stage, has no VehicleCategory row at all, and falls back to the
 * caller's icon. A missing entry is ordinary, never an error.
 */
import { prisma } from '@/lib/prisma'
import { PUBLIC_VEHICLE_VISIBLE_WHERE } from '@/lib/site/vehicleCatalog'

/** Where the bytes come from. Public by design — the proxy re-checks. */
export function vehicleCategoryImagePath(vehicleCategoryId: string): string {
  return `/api/public/catalog-image/vehicle/${vehicleCategoryId}`
}

/**
 * AssetCategory id → image href, for the categories that have one. Nulls and
 * duplicates in the input are fine; an empty input makes no query.
 */
export async function loadCategoryPhotoPaths(
  assetCategoryIds: (string | null | undefined)[],
): Promise<Record<string, string>> {
  const ids = [...new Set(assetCategoryIds.filter((x): x is string => !!x))]
  if (ids.length === 0) return {}
  const cats = await prisma.vehicleCategory.findMany({
    where: { assetCategoryId: { in: ids }, ...PUBLIC_VEHICLE_VISIBLE_WHERE },
    select: { id: true, assetCategoryId: true },
  })
  const out: Record<string, string> = {}
  for (const vc of cats) {
    // First one wins: two published classes can point at one Fleet Pricing
    // category, and the tile only has room for one picture.
    if (!vc.assetCategoryId || out[vc.assetCategoryId]) continue
    out[vc.assetCategoryId] = vehicleCategoryImagePath(vc.id)
  }
  return out
}
