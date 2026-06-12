import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Phase 2 sales pipeline — unified catalog typeahead for the quote
 * builder's "Change match" override. Returns InventoryItem +
 * AssetCategory rows in a single shape (id, type, name, department,
 * dailyRate, weeklyRate). Matches against name/code/description and
 * the curated `aliases` array.
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

  // Token-based matching across all catalog tables. Every whitespace-
  // separated token must hit SOMEWHERE in (code OR description OR
  // aliases) for inventory, (name OR slug OR aliases) for asset
  // category, or (name OR description) for packages. Order-insensitive
  // — "6' Table" finds "6' Folding Table", "Studio Lankershim" finds
  // "Lankershim Studio A", "grip pack" finds "Grip Starter Package".
  const tokens = q.split(/\s+/).filter(Boolean)
  const lower = (t: string) => t.toLowerCase()

  const [invItems, assetCats, packages] = await Promise.all([
    types.has('INVENTORY')
      ? prisma.inventoryItem.findMany({
          where: {
            isActive: true,
            AND: tokens.map((t) => ({
              OR: [
                { code: { contains: t, mode: 'insensitive' as const } },
                { description: { contains: t, mode: 'insensitive' as const } },
                { aliases: { has: lower(t) } },
              ],
            })),
          },
          select: {
            id: true, code: true, description: true,
            department: true, dailyRate: true, weeklyRate: true,
          },
          take: limit,
          orderBy: { qtyOwned: 'desc' },
        })
      : Promise.resolve([]),
    types.has('ASSET_CATEGORY')
      ? prisma.assetCategory.findMany({
          where: {
            AND: tokens.map((t) => ({
              OR: [
                { name: { contains: t, mode: 'insensitive' as const } },
                { slug: { contains: t, mode: 'insensitive' as const } },
                { aliases: { has: lower(t) } },
              ],
            })),
          },
          select: {
            id: true, name: true,
            department: true, dailyRate: true, weeklyRate: true,
          },
          take: limit,
          orderBy: { sortOrder: 'asc' },
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
    ...assetCats.map((a) => ({
      id: a.id,
      type: 'ASSET_CATEGORY' as const,
      name: a.name,
      department: a.department,
      dailyRate: Number(a.dailyRate),
      weeklyRate: a.weeklyRate ? Number(a.weeklyRate) : 0,
    })),
    ...invItems.map((i) => ({
      id: i.id,
      type: 'INVENTORY' as const,
      name: i.description || i.code,
      department: i.department,
      dailyRate: Number(i.dailyRate),
      weeklyRate: Number(i.weeklyRate),
    })),
  ].slice(0, limit)

  return NextResponse.json({ results })
}
