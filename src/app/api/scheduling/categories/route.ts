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
import { BookingItemStatus, BookingStatus, LineItemDepartment } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireReadSession } from '@/lib/scheduling/requireReadSession'

export const dynamic = 'force-dynamic'

/**
 * How far back the demand count looks. There is no upper bound — a
 * booking that STARTS next month is demand too, and the picker should
 * float a type that is busy right now, not only one that was busy in
 * the spring.
 */
const DEMAND_WINDOW_DAYS = 180

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
      id: true,
      legacyAssetCategoryId: true,
      description: true,
      code: true,
      slug: true,
      qtyOwned: true,
      planyoResourceId: true,
      department: true,
      // Rate + code ride along for the Make Reservation modal, which
      // creates an ORDER LINE for the category it holds. The line-items
      // route re-resolves the rate server-side (client rate card wins),
      // so this is the list price the modal shows and submits, never the
      // price of record.
      dailyRate: true,
    },
    orderBy: { description: 'asc' },
  })
  // Demand per category: units reserved (sum of BookingItem.quantity, not
  // a row count — one line for 4 cargo vans is 4 vans out the door) across
  // every non-cancelled booking whose window starts inside the trailing
  // window or later. Unfulfilled items never left the yard, so they don't
  // count. The join lives on Booking (BookingItem carries no dates), which
  // groupBy can't filter across — hence the pluck-and-tally.
  const since = new Date(Date.now() - DEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const reserved = await prisma.bookingItem.findMany({
    where: {
      status: { not: BookingItemStatus.UNFULFILLED },
      booking: {
        startDate: { gte: since },
        status: { notIn: [BookingStatus.CANCELLED, BookingStatus.ARCHIVED] },
      },
    },
    select: { categoryId: true, quantity: true },
  })
  const demand = new Map<string, number>()
  for (const item of reserved) {
    demand.set(item.categoryId, (demand.get(item.categoryId) ?? 0) + (item.quantity || 1))
  }

  const categories = rows.map((r) => ({
    id: r.legacyAssetCategoryId as string,
    // The merged catalog row behind the class — what an ORDER LINE binds
    // (the order builder's Reservation section adds a line from a class).
    inventoryItemId: r.id,
    name: r.description || r.code,
    slug: r.slug,
    code: r.code,
    totalUnits: r.qtyOwned,
    planyoResourceId: r.planyoResourceId,
    department: r.department,
    dailyRate: r.dailyRate == null ? null : Number(r.dailyRate),
    /// Units reserved over DEMAND_WINDOW_DAYS — see above. Consumers that
    /// want the busiest types first sort on this; the array itself stays
    /// alphabetical so the pickers that have always been A–Z still are.
    recentDemand: demand.get(r.legacyAssetCategoryId as string) ?? 0,
  }))
  return NextResponse.json({ ok: true, categories })
}
