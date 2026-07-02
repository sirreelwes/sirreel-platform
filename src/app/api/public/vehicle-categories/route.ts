/**
 * GET /api/public/vehicle-categories — public-facing vehicle catalog.
 *
 * Returns active VehicleCategory rows for the unified production-order
 * page. Distinct from /api/public/catalog (which is InventoryItem
 * supplies). Sorted by sortOrder asc, then name asc.
 *
 * Strict public-safe field whitelist per row:
 *   { id, name, slug, subtitle, photoUrl, dailyRate, sortOrder }
 *
 * dailyRate is returned as a number (or null = price-on-quote). The
 * unified cart's submit handler treats null/0 vehicles as price-on-
 * quote line items.
 *
 * Internal/admin fields (active, createdAt, updatedAt) are not
 * exposed.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { pickEffectiveDailyRate } from '@/lib/pricing/resolveRate'
import { PUBLIC_VEHICLE_VISIBLE_WHERE } from '@/lib/site/vehicleCatalog'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Same visibility gate as the public /vehicles pages: published + at least
  // one image source. Unpublished vehicles never reach the order form.
  const rows = await prisma.vehicleCategory.findMany({
    where: PUBLIC_VEHICLE_VISIBLE_WHERE,
    select: {
      id: true,
      name: true,
      slug: true,
      subtitle: true,
      photoUrl: true,
      dailyRate: true,
      sortOrder: true,
      // Live link to Fleet Pricing — when present, the owned-vehicle rate is
      // read straight from here (never copied), so a Fleet Pricing edit flows
      // through with no second place to maintain. imageUrl is the fallback
      // thumbnail source when the row has no photoUrl of its own.
      assetCategory: { select: { dailyRate: true, imageUrl: true } },
      photos: { select: { id: true }, take: 1 },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })

  const categories = rows.map((r) => {
    // Linked Fleet Pricing rate WINS; else the row's own fallback dailyRate;
    // null → price-on-quote (the sub-rental trailers).
    const effective = pickEffectiveDailyRate(r)
    // Thumbnail: the vehicle proxy prefers the primary gallery photo, then the
    // row's own photoUrl, then the linked AssetCategory image. All are PRIVATE
    // blobs → expose only the public scoped proxy path (never the raw URL),
    // and only when an image actually exists.
    const hasImage = r.photos.length > 0 || !!(r.photoUrl || r.assetCategory?.imageUrl)
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      subtitle: r.subtitle,
      photoUrl: hasImage ? `/api/public/catalog-image/vehicle/${r.id}` : null,
      dailyRate: effective == null ? null : Number(effective),
      sortOrder: r.sortOrder,
    }
  })

  return NextResponse.json({
    categories,
    totals: { categories: categories.length },
  })
}
