import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Phase 2 sales pipeline — unified catalog typeahead for the quote
 * builder's "Change match" override.
 *
 * Post catalog merge (Aug 2026) every catalog row is an InventoryItem,
 * so this queries ONE table and every hit comes back type 'INVENTORY'.
 * Querying both tables here would list the 13 merged rows twice — once
 * as the frozen AssetCategory, once as its merged copy.
 *
 * Hits carry `trackingMode` so the picker can tell a unit-tracked
 * vehicle or stage from warehouse gear. The legacy `types=` values still
 * work and now select on that: ASSET_CATEGORY => UNIT_TRACKED,
 * INVENTORY => QUANTITY (which keeps the package builder's component
 * picker to warehouse gear, as before).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)))
  if (!q) return NextResponse.json({ results: [] })
  // `types=` filter — comma-separated list of INVENTORY, ASSET_CATEGORY,
  // PACKAGE. When omitted, all three are returned. Used by:
  //   - line-item combobox: default (all three)
  //   - admin package builder's component picker: types=INVENTORY
  //   - any caller that wants to scope the typeahead
  const typesParam = searchParams.get('types')
  const types = typesParam
    ? new Set(typesParam.split(',').map((t) => t.trim().toUpperCase()))
    : new Set(['INVENTORY', 'ASSET_CATEGORY', 'PACKAGE'])

  // Both legacy catalog types now live in one table, separated by
  // trackingMode. Asking for both (the default) means no filter at all.
  const wantsQuantity = types.has('INVENTORY')
  const wantsUnitTracked = types.has('ASSET_CATEGORY')
  const trackingFilter =
    wantsQuantity && wantsUnitTracked
      ? undefined
      : wantsQuantity
        ? ('QUANTITY' as const)
        : wantsUnitTracked
          ? ('UNIT_TRACKED' as const)
          : undefined

  // Token-based matching across all catalog tables. Every whitespace-
  // separated token must hit SOMEWHERE in (code OR description OR
  // aliases) for inventory, (name OR slug OR aliases) for asset
  // category, or (name OR description) for packages. Order-insensitive
  // — "6' Table" finds "6' Folding Table", "Studio Lankershim" finds
  // "Lankershim Studio A", "grip pack" finds "Grip Starter Package".
  const tokens = q.split(/\s+/).filter(Boolean)
  const lower = (t: string) => t.toLowerCase()

  const [invItems, packages] = await Promise.all([
    wantsQuantity || wantsUnitTracked
      ? prisma.inventoryItem.findMany({
          where: {
            isActive: true,
            ...(trackingFilter ? { trackingMode: trackingFilter } : {}),
            AND: tokens.map((t) => ({
              OR: [
                { code: { contains: t, mode: 'insensitive' as const } },
                { description: { contains: t, mode: 'insensitive' as const } },
                { slug: { contains: t, mode: 'insensitive' as const } },
                { aliases: { has: lower(t) } },
              ],
            })),
          },
          select: {
            id: true, code: true, description: true, trackingMode: true,
            department: true, dailyRate: true, weeklyRate: true,
          },
          take: limit,
          // Unit-tracked rows (vehicles, stages) are the headline answers;
          // warehouse gear ranks under them by how much of it we own.
          orderBy: [{ trackingMode: 'asc' }, { qtyOwned: 'desc' }],
        })
      : Promise.resolve([]),
    types.has('PACKAGE')
      ? prisma.package.findMany({
          where: {
            active: true,
            AND: tokens.map((t) => ({
              OR: [
                { name: { contains: t, mode: 'insensitive' as const } },
                { description: { contains: t, mode: 'insensitive' as const } },
              ],
            })),
          },
          select: {
            id: true, name: true, description: true,
            department: true, pricePerDay: true,
            items: {
              select: {
                qty: true,
                inventoryItemId: true,
                inventoryItem: {
                  select: { id: true, code: true, description: true, dailyRate: true, weeklyRate: true, department: true },
                },
              },
            },
          },
          take: limit,
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
  ])

  const results = [
    // Packages first — they're the "best" answer when they match
    // because picking one fills the most rows in a single tap.
    ...packages.map((p) => ({
      id: p.id,
      type: 'PACKAGE' as const,
      name: p.name,
      department: p.department,
      dailyRate: Number(p.pricePerDay),
      weeklyRate: 0,
      items: p.items.map((it) => ({
        inventoryItemId: it.inventoryItemId,
        name: it.inventoryItem.description || it.inventoryItem.code,
        code: it.inventoryItem.code,
        qty: it.qty,
        dailyRate: Number(it.inventoryItem.dailyRate),
        weeklyRate: Number(it.inventoryItem.weeklyRate),
        department: it.inventoryItem.department,
      })),
    })),
    // Every catalog hit is an InventoryItem now, so callers bind
    // inventoryItemId and never assetCategoryId.
    ...invItems.map((i) => ({
      id: i.id,
      type: 'INVENTORY' as const,
      trackingMode: i.trackingMode,
      name: i.description || i.code,
      department: i.department,
      dailyRate: Number(i.dailyRate),
      weeklyRate: Number(i.weeklyRate),
    })),
  ].slice(0, limit)

  return NextResponse.json({ results })
}
