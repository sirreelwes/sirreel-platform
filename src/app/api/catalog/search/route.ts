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

  const [invItems, assetCats] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { aliases: { has: q.toLowerCase() } },
        ],
      },
      select: {
        id: true, code: true, description: true,
        department: true, dailyRate: true, weeklyRate: true,
      },
      take: limit,
      orderBy: { qtyOwned: 'desc' },
    }),
    prisma.assetCategory.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { aliases: { has: q.toLowerCase() } },
        ],
      },
      select: {
        id: true, name: true,
        department: true, dailyRate: true, weeklyRate: true,
      },
      take: limit,
      orderBy: { sortOrder: 'asc' },
    }),
  ])

  const results = [
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
