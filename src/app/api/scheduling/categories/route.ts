/**
 * Lightweight category list for the operator-facing "+ New Hold"
 * picker on /gantt (Reservations). Returns only the fields the
 * dropdown needs.
 *
 * Scope rules:
 *   - department ∈ (VEHICLES, STAGES) — supplies/expendables live in
 *     InventoryItem, not AssetCategory; G&E etc. would land in their
 *     own department enum value if/when they get unit-tracked.
 *   - reservableOnGantt = true — operator-facing flag (orthogonal to
 *     isPublished, which controls storefront / quote-side visibility).
 *     Flipped false on test rigs so they don't surface in the picker.
 *   - assets.some({}) — the category has at least one Asset row,
 *     i.e. there's something concrete to hold against. Empty
 *     placeholders (Stakebed, Scissor Lift, UTAH Vehicles, etc.)
 *     drop out automatically.
 */
import { NextResponse } from 'next/server'
import { LineItemDepartment } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireReadSession } from '@/lib/scheduling/requireReadSession'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireReadSession()
  if (denied) return denied

  // Read the merged catalog rows so name and unit count are live —
  // totalUnits on the frozen AssetCategory is NOT mirrored and drifts as
  // soon as qtyOwned is edited. The returned `id` stays the AssetCategory
  // id: the gantt posts it back as a hold's categoryId.
  const rows = await prisma.inventoryItem.findMany({
    where: {
      department: { in: [LineItemDepartment.VEHICLES, LineItemDepartment.STAGES] },
      reservableOnGantt: true,
      legacyAssetCategoryId: { not: null },
      assets: { some: {} },
    },
    select: {
      legacyAssetCategoryId: true,
      description: true,
      code: true,
      slug: true,
      qtyOwned: true,
      planyoResourceId: true,
      department: true,
    },
    orderBy: { description: 'asc' },
  })
  const categories = rows.map((r) => ({
    id: r.legacyAssetCategoryId as string,
    name: r.description || r.code,
    slug: r.slug,
    totalUnits: r.qtyOwned,
    planyoResourceId: r.planyoResourceId,
    department: r.department,
  }))
  return NextResponse.json({ ok: true, categories })
}
