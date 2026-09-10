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
 * Optional `?q=` filter — tokenized, plural-tolerant, case-insensitive
 * match across description + code + category name + aliases[], via the
 * shared src/lib/site/publicTextMatch.ts. The Home hero pill
 * (/api/public/search) matches through the SAME helper, so a query that
 * finds a thing there finds it here too — which is the whole promise of
 * the hero field, since it lands the client on this route.
 *
 * It used to substring-match the WHOLE raw query against each field, and
 * that quietly failed every plural: the catalog names things in the
 * singular ("Walkie, Digital") and the alias seed deliberately keeps only
 * the singular forms (scripts/seed-catalog-aliases.ts strips "walkies"
 * and "radios" so a bare walkie resolves to the digital row). "walkies"
 * — what a crew actually types — matched nothing at all and the form
 * said we don't rent them.
 *
 * Categories with zero qualifying items are omitted from the
 * response — naturally drops the legacy empty categories
 * (Electrical/Grip/Lighting Equipment, Production Supplies).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PUBLIC_CATALOG_VISIBLE_WHERE, hasPublicPrice } from '@/lib/catalog/publicVisibility'
import { haystack, matchesQuery, queryVariants } from '@/lib/site/publicTextMatch'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()

  // Visibility gate is always enforced server-side — only client-orderable
  // items (publicVisible + active + categorized) are ever returned, so an
  // alias can never surface an internal-only item.
  const rows = await prisma.inventoryItem.findMany({
    where: PUBLIC_CATALOG_VISIBLE_WHERE,
    select: {
      id: true,
      code: true,
      description: true,
      aliases: true,
      dailyRate: true,
      includedFree: true,
      imageUrl: true,
      type: true,
      color: true,
      variantGroupKey: true,
      category: {
        select: { id: true, slug: true, name: true, sortOrder: true },
      },
    },
    orderBy: [
      { category: { sortOrder: 'asc' } },
      { description: 'asc' },
    ],
  })

  // Every typed token must hit the row somewhere, in any of its
  // singular/plural/measure spellings — so "walkies" finds "Walkie,
  // Digital" and "6 tables" finds "Table, 6' Folding". Filtered
  // in-process because Postgres/Prisma can't substring-match an element
  // inside a String[] (`has` is exact-element only); the client catalog
  // is ~194 rows so this is trivial. No query → return all.
  const variants = queryVariants(q)
  const items = q
    ? rows.filter((it) =>
        matchesQuery(
          haystack(it.description, it.code, it.category?.name, it.aliases.join(' ')),
          variants,
        ),
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
    items: Array<{ id: string; name: string; price: number; included: boolean; image: string | null; type: string; category: string; color: string | null; variantGroupKey: string | null }>
  }
  const groups = new Map<string, CatGroup>()
  for (const it of items) {
    if (!it.category) continue
    const price = Number(it.dailyRate)
    // $0 disambiguation (fail-safe) — see hasPublicPrice:
    //   price > 0                         → normal, orderable.
    //   price === 0 && includedFree       → "Included", not orderable.
    //   price === 0 && !includedFree      → missing price → HIDE entirely, so
    //                                       an un-priced item never leaks as
    //                                       "FREE"/orderable to a client.
    if (!hasPublicPrice(it)) continue
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
      price,
      included: price === 0 && it.includedFree,
      // Public scoped image proxy path — emitted ONLY when a photo exists, so
      // the form renders a thumb or the placeholder without a wasted 404. Never
      // the raw private blob URL.
      image: it.imageUrl ? `/api/public/catalog-image/supply/${it.id}` : null,
      type: it.type, // EQUIPMENT | EXPENDABLE | … (catalog-side authority)
      category: it.category.slug,
      // Color-variant grouping — items sharing variantGroupKey render as one
      // card with color swatches on the form; null = standalone card.
      color: it.color,
      variantGroupKey: it.variantGroupKey,
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
