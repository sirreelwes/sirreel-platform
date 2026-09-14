import { NextRequest, NextResponse } from 'next/server'
import { partnerUnitDepartment } from '@/lib/site/partnerSections'
import { catalogItemSupportsLcdw } from '@/lib/pricing/lcdwEligibility'
import { aliasesAnswerQuery } from '@/lib/sales/aliasMatch'
import {
  TENT_ACCESSORY_SLOTS,
  TENT_CATEGORY_SLUG,
  isTentFamilyQuery,
  orderTentFirst,
} from '@/lib/sales/tentFirst'
import { prisma } from '@/lib/prisma'
import { tokenVariants, mergeMeasureTokens } from '@/lib/sales/catalogMatcher'
import { negotiated } from '@/lib/pricing/companyRate'

export const dynamic = 'force-dynamic'

// Candidate-set size on a tent query. The whole tent family is ~45 rows
// (every canopy size in every color, the sidewalls, the sandbags), so this
// takes all of it and lets the ranking decide; the default `limit * 3`
// stopped inside the canopies.
const TENT_OVERFETCH = 150
// The tent category is a few dozen rows and only the accessories in it
// survive the ordering, so there is nothing to gain from taking more.
const TENT_COMPANION_TAKE = 60

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
 * PARTNER UNITS (2026-09-10). A rep building a quote types into this box, so
 * anything that isn't in it doesn't get sold — which made "one agreement, lots
 * of services" untrue in the only place it had to be true. SubcontractedVehicle
 * is a separate table from the merged catalog, so partner units are queried
 * alongside and returned as type 'SUB_VEHICLE'. Before this, the only way a
 * partner unit reached an order was the "Sub-rent…" button on a line that
 * already existed — which needs the rep to already know PowerTrip can supply it.
 *
 * Three things are deliberately different about those hits:
 *   · they price at the partner's LIST rate and ignore the client's rate card.
 *     A CompanyRate is a deal on OUR catalog; the partner's list is what the
 *     production pays either way (partnerShare.ts), and SirReel's share comes
 *     out of the partner's side.
 *   · `lcdwEligible` is always false. Wes 2026-09-07, on finding a $24/day
 *     waiver offered against King Kong's motorhome: "close it." We cannot
 *     waive damage on a vehicle we don't own.
 *   · they carry `vendorName` — staff-facing, so always shown here regardless
 *     of the client-facing naming permission (partnerAttribution.ts).
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
    // SUB_VEHICLE is OPT-IN, not in the default set. A caller that gets a
    // partner hit has to know what to do with one — bind subcontractedVehicleId
    // rather than a catalog FK — and a picker that doesn't would quietly write
    // a SubcontractedVehicle id into inventoryItemId. Ask for it by name.
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

  // ── Tents ─────────────────────────────────────────────────────────
  //
  // Wes 2026-09-13: "Whenever tent, Canopy, pop-up are entered. The order
  // form should offer the tent first and the accessories like side walls
  // next." The rule itself is src/lib/sales/tentFirst.ts (shared with the
  // client-facing order form); this flag turns on the two things the rule
  // cannot do from outside the query — over-fetching far enough that the
  // accessories are IN the candidate set, and pulling the ones that only a
  // tent knows to ask for. Everything below is a no-op on any other query.
  const tentQuery = isTentFamilyQuery(q)

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

  // Partner units. Matched on name + type only: their `specs` is a spec sheet
  // and `publicDescription` is marketing copy, and letting either into an
  // AND-ed token match makes "generator" hit a light tower whose blurb happens
  // to mention one.
  const subVehiclesP = types.has('SUB_VEHICLE')
    ? prisma.subcontractedVehicle.findMany({
        where: {
          isActive: true,
          offeredToSirReel: true,
          vendor: { isActive: true },
          AND: variants.map((vs) => ({
            OR: vs.flatMap((v) => [
              { name: { contains: v, mode: 'insensitive' as const } },
              { vehicleType: { contains: v, mode: 'insensitive' as const } },
            ]),
          })),
        },
        select: {
          id: true, name: true, vehicleType: true, listDailyRate: true, listWeeklyRate: true,
          catalogSection: true,
          vendor: { select: { name: true, partnerKind: true, catalogSection: true } },
        },
        take: limit,
        orderBy: { name: 'asc' },
      })
    : Promise.resolve([])

  // The accessories a tent query has to OFFER even though the rep never
  // typed their name. "Sidewalls, 10x15" carries the aliases "tent wall"
  // and "tent sidewall", and an alias only answers a query that COVERS it
  // (aliasMatch.ts) — so a bare "tent" reaches the alias and stops, and
  // the sidewalls were unreachable until the rep already knew to type
  // "wall". "Next" only means something if they are on the list, so the
  // tent category comes along on a tent query and the ordering below
  // decides where it lands. Quantity-tracked gear, so it rides the same
  // trackingFilter the caller asked for and is skipped outright when the
  // caller wants unit-tracked rows only (the package builder, /orders/new's
  // vehicle pass).
  const tentCompanionsP = tentQuery && wantsQuantity
    ? prisma.inventoryItem.findMany({
        where: {
          isActive: true,
          ...(trackingFilter ? { trackingMode: trackingFilter } : {}),
          category: { slug: TENT_CATEGORY_SLUG },
        },
        select: {
          id: true, code: true, description: true, trackingMode: true,
          department: true, dailyRate: true, weeklyRate: true,
        },
        take: TENT_COMPANION_TAKE,
        orderBy: [{ trackingMode: 'asc' }, { qtyOwned: 'desc' }],
      })
    : Promise.resolve([])

  const [invItems, tentCompanions, packages, subVehicles] = await Promise.all([
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
          // On a tent query the candidate set has to be wide enough to
          // still hold the accessories after ~30 canopy rows (every size
          // in every color) have matched — `limit * 3` cut them off before
          // the ranking ever saw them.
          take: tentQuery ? TENT_OVERFETCH : limit * 3,
          // Unit-tracked rows (vehicles, stages) are the headline answers;
          // warehouse gear ranks under them by how much of it we own.
          orderBy: [{ trackingMode: 'asc' }, { qtyOwned: 'desc' }],
        })
      : Promise.resolve([]),
    tentCompanionsP,
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
    subVehiclesP,
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
  // Companions merge in BEFORE the relevance pass so they are ranked by
  // the rest of the query like anything else — "10x10 tent" puts the
  // 10x10 sidewall at the front of the accessory tier — and deduped
  // against the rows the query found on its own.
  const seenIds = new Set(invItems.map((i) => i.id))
  const candidates = [
    ...invItems,
    ...tentCompanions.filter((i) => !seenIds.has(i.id)),
  ]

  const ranked = [...candidates].sort((a, b) => {
    const an = a.description || a.code
    const bn = b.description || b.code
    // Unit-tracked rows keep their headline position.
    if (a.trackingMode !== b.trackingMode) return a.trackingMode === 'UNIT_TRACKED' ? -1 : 1
    const diff = nameScore(bn) - nameScore(an)
    if (diff !== 0) return diff
    return an.length - bn.length
  })

  // Tent first, accessories next (Wes 2026-09-13). A no-op on every other
  // query. Applied HERE — after relevance, before the rate-card lookup —
  // so the reserve is decided on the list that will actually be shown and
  // the negotiated-rate query only prices rows that survive it. The budget
  // is what the final slice leaves the catalog rows: packages are the
  // "best" answer and keep their slots ahead of this.
  const ordered = orderTentFirst(ranked, q, {
    name: (i) => i.description || i.code,
    limit: Math.max(0, limit - packages.length),
    minAccessories: TENT_ACCESSORY_SLOTS,
  })

  // Client rate card, one query for every hit on screen. Packages are
  // priced by their own `pricePerDay` row and have no catalog item to
  // hang a negotiated rate off, so they stay at list — a negotiated
  // package price would be its own kind of row.
  const negotiatedById = new Map<string, { daily: number | null; weekly: number | null }>()
  if (companyId && ordered.length) {
    const rows = await prisma.companyRate.findMany({
      where: { companyId, inventoryItemId: { in: ordered.map((i) => i.id) } },
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

  const num = (d: unknown) => (d == null ? 0 : Number(d))

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
    ...ordered.map((i) => {
      const deal = negotiatedById.get(i.id)
      // Whether the damage waiver may be offered alongside this item —
      // computed here so the agent builder and the client-facing one
      // cannot drift on the rule. See src/lib/pricing/lcdwEligibility.
      const lcdwEligible = catalogItemSupportsLcdw({ code: i.code, department: i.department })
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
        lcdwEligible,
        listDailyRate: listDaily,
        listWeeklyRate: listWeekly,
        negotiated: !!deal,
      }
    }),
    // Partner units last: they are a real answer but never the obvious one,
    // and a rep searching "generator" should see what we own first.
    ...subVehicles.map((v) => ({
      id: v.id,
      type: 'SUB_VEHICLE' as const,
      name: v.name,
      // Partner units carry no LineItemDepartment; the section decides (Photo
      // Shoot Rentals is a department too), then the partner's kind.
      department: partnerUnitDepartment(v, v.vendor),
      dailyRate: num(v.listDailyRate),
      weeklyRate: num(v.listWeeklyRate),
      listDailyRate: num(v.listDailyRate),
      listWeeklyRate: num(v.listWeeklyRate),
      negotiated: false,
      // Never — we cannot waive damage on a vehicle we do not own.
      lcdwEligible: false,
      vendorName: v.vendor.name,
      unitType: v.vehicleType,
    })),
  ].slice(0, limit)

  return NextResponse.json({ results })
}
