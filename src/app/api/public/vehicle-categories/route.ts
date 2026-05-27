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

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await prisma.vehicleCategory.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      slug: true,
      subtitle: true,
      photoUrl: true,
      dailyRate: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })

  const categories = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    subtitle: r.subtitle,
    photoUrl: r.photoUrl,
    dailyRate: r.dailyRate == null ? null : Number(r.dailyRate),
    sortOrder: r.sortOrder,
  }))

  return NextResponse.json({
    categories,
    totals: { categories: categories.length },
  })
}
