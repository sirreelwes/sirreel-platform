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

export const dynamic = 'force-dynamic'

export async function GET() {
  const categories = await prisma.assetCategory.findMany({
    where: {
      department: { in: [LineItemDepartment.VEHICLES, LineItemDepartment.STAGES] },
      reservableOnGantt: true,
      assets: { some: {} },
    },
    select: { id: true, name: true, slug: true, totalUnits: true, planyoResourceId: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ ok: true, categories })
}
