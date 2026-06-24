/**
 * GET /api/public/catalog — public-facing supply catalog.
 *
 * Phase 2 of the supply-ordering brief. Unauthenticated. Returns
 * InventoryItem rows where publicVisible=true AND isActive=true AND
 * categoryId IS NOT NULL, grouped by category and sorted by
 * InventoryCategory.sortOrder.
 *
 * Strict public-safe field whitelist per item:
 *   { id, name, price, type, category }
 *
 * Deliberately NOT exposed (internal/RW/billing-side):
 *   code, aliases, weeklyRate, qtyOwned, department,
 *   manufacturer, model, specs, dimensions,
 *   needsReview, rwId, rwLastSyncedAt, location, locationId,
 *   replacementCost, imageUrl (could be exposed later as
 *   thumbnailUrl with a transform, but not now).
 *
 * Optional `?q=` filter — case-insensitive match against:
 *   - description (substring)
 *   - code (substring)
 *   - aliases[] (exact element match against lowercased q;
 *     synonyms in the catalog seed are curated for this — e.g.
 *     "genny" → generators, "pop up" → caravan canopies).
 *
 * Same alias-aware pattern as /api/catalog/search so a query
 * surfacing items in the quote-builder also surfaces them here
 * (shared underlying aliases[] column on InventoryItem).
 *
 * Categories with zero qualifying items are omitted from the
 * response — naturally drops the legacy empty categories
 * (Electrical/Grip/Lighting Equipment, Production Supplies).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()

  // Visibility gate is always enforced server-side — only client-orderable
  // items (publicVisible + active + categorized) are ever returned, so an
  // alias can never surface an internal-only item.
  const where: Record<string, unknown> = {
    publicVisible: true,
    isActive: true,
    categoryId: { not: null },
  }

  const rows = await prisma.inventoryItem.findMany({
    where,
    select: {
      id: true,
      code: true,
      description: true,
      aliases: true,
      dailyRate: true,
      type: true,
      category: {
        select: { id: true, slug: true, name: true, sortOrder: true },
      },
    },
    orderBy: [
      { category: { sortOrder: 'asc' } },
      { description: 'asc' },
    ],
  })

  // Case-insensitive PARTIAL (substring) match across name + aliases +
  // category. Filtered in-process because Postgres/Prisma can't substring-
  // match an element inside a String[] (`has` is exact-element only); the
  // client catalog is ~194 rows so this is trivial. No query → return all.
  const ql = q.toLowerCase()
  const items = q
    ? rows.filter(
        (it) =>
          (it.description ?? '').toLowerCase().includes(ql) ||
          (it.code ?? '').toLowerCase().includes(ql) ||
          (it.category?.name ?? '').toLowerCase().includes(ql) ||
          it.aliases.some((a) => a.toLowerCase().includes(ql)),
      )
    : rows

  // Group by category. Items with a NULL category were excluded
  // server-side by the where clause; the `if (!it.category)` guard
  // below is defensive against Prisma typing only.
  type CatGroup = {
    id: string
    slug: string
    name: string
    sortOrder: number
    items: Array<{ id: string; name: string; price: number; type: string; category: string }>
  }
  const groups = new Map<string, CatGroup>()
  for (const it of items) {
    if (!it.category) continue
    const slot =
      groups.get(it.category.id) ?? {
        id: it.category.id,
        slug: it.category.slug,
        name: it.category.name,
        sortOrder: it.category.sortOrder,
        items: [],
      }
    slot.items.push({
      id: it.id,
      name: it.description ?? '',
      price: Number(it.dailyRate),
      type: it.type, // EQUIPMENT | EXPENDABLE | … (catalog-side authority)
      category: it.category.slug,
    })
    groups.set(it.category.id, slot)
  }
  const categories = [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder)
  const totalItems = categories.reduce((s, c) => s + c.items.length, 0)

  return NextResponse.json({
    categories,
    totals: { categories: categories.length, items: totalItems },
  })
}
