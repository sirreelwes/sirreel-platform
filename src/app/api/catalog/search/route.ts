import { NextRequest, NextResponse } from 'next/server'
import { aliasesAnswerQuery } from '@/lib/sales/aliasMatch'
import { prisma } from '@/lib/prisma'
import { tokenVariants, mergeMeasureTokens } from '@/lib/sales/catalogMatcher'
import { negotiated } from '@/lib/pricing/companyRate'

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
 * `companyId=` applies that client's negotiated rate card, so a picked
 * line pre-fills at THEIR price rather than at list. Callers that know
 * the order's client must pass it — otherwise the rep is shown $170,
 * types nothing, and the client is quoted list despite having a deal.
 * `listDailyRate` / `listWeeklyRate` ride along so the picker can show
 * what the negotiated number replaced.
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
  const companyId = (searchParams.get('companyId') || '').trim() || null
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
  //
  // Each token carries its singular forms, because the catalog names things
  // in the singular and crews ask in the plural. Matching "tables"
  // literally excluded "Table, 6' Folding" — every AND-ed token has to hit,
  // so one plural was enough to empty the whole dropdown.
  // "4 ft table" → ["4ft", "table"] before variants, so the bare unit word
  // isn't its own AND-ed token with nothing to hit.
  const tokens = mergeMeasureTokens(q.split(/\s+/).filter(Boolean))
  const variants = tokens.map(tokenVariants)

  // ── Multi-word aliases ────────────────────────────────────────────
  //
  // `aliases: { has: v }` is EXACT array-element equality, and the query
  // above is split on whitespace with every token AND-ed. So a token
  // "garment" could never match the element "garment rack", and every
  // multi-word alias in the catalog was dead on arrival — "garment rack",
  // "walkie talkie" and "trash can liner" all returned nothing, while the
  // single-word "walkie" worked. That silently defeated the curated
  // aliases in scripts/seed-catalog-aliases.ts, which exist precisely
  // because SirReel's name for a thing and the crew's share no words.
  //
  // Resolve alias hits separately: pull the rows that HAVE aliases (a
  // curated handful, not the 1800-row catalog) and substring-match each
  // token against them in JS. A row qualifies only if EVERY token hits
  // one of its aliases, matching the AND semantics of the main query.
  // An alias counts only when the QUERY COVERS IT — every word of the
  // alias has to be something the user actually typed. Substring matching
  // is too loose in exactly the way that matters: it lets a bare "walkie"
  // match the alias "analog walkie", which would hand back the analog
  // radio and undo Wes's 8/17 ruling that a bare walkie means the digital
  // one. Requiring alias ⊆ query keeps "walkie" → digital, "analog
  // walkie" → analog, and still resolves "garment rack" and "trash can
  // liner" the way the seed intended.
  const aliasRows = await prisma.inventoryItem.findMany({
    where: { isActive: true, NOT: { aliases: { isEmpty: true } } },
    select: { id: true, aliases: true },
  })
  const aliasMatchIds = aliasRows
    .filter((row) => aliasesAnswerQuery(row.aliases, variants))
    .map((row) => row.id)

  const [invItems, packages] = await Promise.all([
    wantsQuantity || wantsUnitTracked
      ? prisma.inventoryItem.findMany({
          where: {
            isActive: true,
            ...(trackingFilter ? { trackingMode: trackingFilter } : {}),
            OR: [
              // Rows whose aliases satisfied every token (resolved above).
              ...(aliasMatchIds.length ? [{ id: { in: aliasMatchIds } }] : []),
              {
                AND: variants.map((vs) => ({
                  OR: vs.flatMap((v) => [
                    { code: { contains: v, mode: 'insensitive' as const } },
                    { description: { contains: v, mode: 'insensitive' as const } },
                    { slug: { contains: v, mode: 'insensitive' as const } },
                    { aliases: { has: v } },
                  ]),
                })),
              },
            ],
          },
          select: {
            id: true, code: true, description: true, trackingMode: true,
            department: true, dailyRate: true, weeklyRate: true,
          },
          // Over-fetch so the name-relevance pass below has something to
          // rank; the slice back to `limit` happens after sorting.
          take: limit * 3,
          // Unit-tracked rows (vehicles, stages) are the headline answers;
          // warehouse gear ranks under them by how much of it we own.
          orderBy: [{ trackingMode: 'asc' }, { qtyOwned: 'desc' }],
        })
      : Promise.resolve([]),
    types.has('PACKAGE')
      ? prisma.package.findMany({
          where: {
            active: true,
            AND: variants.map((vs) => ({
              OR: vs.flatMap((v) => [
                { name: { contains: v, mode: 'insensitive' as const } },
                { description: { contains: v, mode: 'insensitive' as const } },
              ]),
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

  // Relevance pass. The DB filter only says "every token hit something" —
  // it can't tell a row that hit on its NAME from one that hit on a code or
  // an alias, and that's the difference between the obvious answer and a
  // near-miss. Rank by tokens found in the name, then prefer the shorter
  // (more general) name: "Table, 6' Folding" over "Table, 6' Folding
  // (Half Fold)".
  const nameScore = (name: string): number => {
    const n = name.toLowerCase()
    return variants.reduce((sum, vs) => sum + (vs.some((v) => n.includes(v)) ? 1 : 0), 0)
  }
  const ranked = [...invItems].sort((a, b) => {
    const an = a.description || a.code
    const bn = b.description || b.code
    // Unit-tracked rows keep their headline position.
    if (a.trackingMode !== b.trackingMode) return a.trackingMode === 'UNIT_TRACKED' ? -1 : 1
    const diff = nameScore(bn) - nameScore(an)
    if (diff !== 0) return diff
    return an.length - bn.length
  })

  // Client rate card, one query for every hit on screen. Packages are
  // priced by their own `pricePerDay` row and have no catalog item to
  // hang a negotiated rate off, so they stay at list — a negotiated
  // package price would be its own kind of row.
  const negotiatedById = new Map<string, { daily: number | null; weekly: number | null }>()
  if (companyId && ranked.length) {
    const rows = await prisma.companyRate.findMany({
      where: { companyId, inventoryItemId: { in: ranked.map((i) => i.id) } },
      select: { inventoryItemId: true, dailyRate: true, weeklyRate: true },
    })
    for (const r of rows) {
      const d = negotiated(r.dailyRate)
      const w = negotiated(r.weeklyRate)
      if (d || w) {
        negotiatedById.set(r.inventoryItemId, { daily: d ? Number(d) : null, weekly: w ? Number(w) : null })
      }
    }
  }

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
    ...ranked.map((i) => {
      const deal = negotiatedById.get(i.id)
      const listDaily = Number(i.dailyRate)
      const listWeekly = Number(i.weeklyRate)
      return {
        id: i.id,
        type: 'INVENTORY' as const,
        trackingMode: i.trackingMode,
        name: i.description || i.code,
        department: i.department,
        // What the line should bill at for this client.
        dailyRate: deal?.daily ?? listDaily,
        weeklyRate: deal?.weekly ?? listWeekly,
        listDailyRate: listDaily,
        listWeeklyRate: listWeekly,
        negotiated: !!deal,
      }
    }),
  ].slice(0, limit)

  return NextResponse.json({ results })
}
