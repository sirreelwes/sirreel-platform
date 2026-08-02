import { prisma } from '@/lib/prisma'
import { catalogIdForAssetCategory } from '@/lib/catalog/resolve'
import type { LineItemDepartment, LineItemType } from '@prisma/client'

/**
 * Phase 2 sales pipeline — catalog matching helpers shared between the
 * AI quote extractor (parse-quote route) and the eventual quote-builder
 * UI. The two-table split these helpers used to paper over is gone —
 * the Aug 2026 merge folded AssetCategory into InventoryItem, so every
 * catalog row is one row in one table and `CatalogProduct` is now the
 * shape of that table rather than a union of two.
 */

export type CatalogType = 'INVENTORY' | 'ASSET_CATEGORY'

export interface CatalogProduct {
  id: string
  /**
   * Always 'INVENTORY' for catalog rows since the Aug 2026 merge — the
   * id is an InventoryItem id and binds to inventoryItemId. 'PACKAGE'
   * still comes from the package path.
   */
  type: CatalogType
  name: string
  aliases: string[]
  department: LineItemDepartment
  dailyRate: number
  weeklyRate: number
  /**
   * The catalog row's own LineItemType. Before the merge, "this came
   * from the AssetCategory table" was how callers inferred VEHICLE;
   * both live in one table now, so the row states it directly.
   */
  lineType: LineItemType
}

/**
 * Strategy B (per the Phase 2 brief): the AI catalog snippet contains
 * (a) every AssetCategory row (only 13 — keeps fleet/stage coverage
 * complete) and (b) every InventoryItem with non-empty aliases (the set
 * we've curated for AI matching).
 *
 * This deliberately does NOT preempt expansion to top-N-by-volume — we
 * surface InventoryItems to the AI only after they've earned aliases.
 * As we encounter "no match" warnings on high-volume items in
 * production, we extend the seed and re-run; that automatically expands
 * the AI snippet.
 *
 * The other 489 InventoryItems still exist in the DB and are reachable
 * via server-side alias-tokenized fallback (see fallbackMatch below).
 */
export async function loadCatalogForSnippet(): Promise<CatalogProduct[]> {
  // One table since the merge. Unit-tracked rows are what used to be
  // AssetCategories and are ALWAYS included — the old query took every
  // one of them regardless of aliases, and filtering them on aliases
  // here would quietly drop fleet and stage coverage out of the AI
  // snippet. Warehouse gear still has to earn its place with aliases.
  const invItems = await prisma.inventoryItem.findMany({
    where: {
      isActive: true,
      OR: [
        { trackingMode: 'UNIT_TRACKED' },
        { NOT: { aliases: { isEmpty: true } } },
      ],
    },
    select: {
      id: true,
      code: true,
      description: true,
      aliases: true,
      department: true,
      dailyRate: true,
      weeklyRate: true,
      type: true,
      trackingMode: true,
      sortOrder: true,
      qtyOwned: true,
    },
    orderBy: [{ trackingMode: 'asc' }, { sortOrder: 'asc' }, { qtyOwned: 'desc' }],
  })

  return invItems.map((i) => ({
    id: i.id,
    type: 'INVENTORY' as const,
    name: i.description || i.code,
    aliases: i.aliases,
    department: i.department,
    dailyRate: Number(i.dailyRate),
    weeklyRate: Number(i.weeklyRate),
    lineType: i.type,
  }))
}

/** Department-grouped, compact, deterministic — fed verbatim to the AI prompt. */
export function renderCatalogSnippet(catalog: CatalogProduct[]): string {
  const byDept = new Map<LineItemDepartment, CatalogProduct[]>()
  for (const p of catalog) {
    if (!byDept.has(p.department)) byDept.set(p.department, [])
    byDept.get(p.department)!.push(p)
  }
  const order: LineItemDepartment[] = [
    'VEHICLES',
    'STAGES',
    'COMMUNICATIONS',
    'GE',
    'EXPENDABLES',
    'PRO_SUPPLIES',
    'ART',
  ]
  const lines: string[] = []
  for (const dept of order) {
    const list = byDept.get(dept)
    if (!list || list.length === 0) continue
    lines.push(`[${dept}]`)
    for (const p of list) {
      const aliasStr = p.aliases.length > 0 ? ` | aliases: ${p.aliases.join(', ')}` : ''
      lines.push(`${p.type} ${p.id} | ${p.name}${aliasStr}`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/**
 * Verify that an AI-returned (id, type) pair corresponds to an actual
 * catalog row. Returns the product if found, null otherwise.
 */
export async function validateCatalogMatch(
  id: string,
  type: CatalogType
): Promise<CatalogProduct | null> {
  if (type === 'INVENTORY') {
    const i = await prisma.inventoryItem.findUnique({
      where: { id },
      select: {
        id: true, code: true, description: true,
        aliases: true, department: true,
        dailyRate: true, weeklyRate: true, isActive: true, type: true,
      },
    })
    if (!i || !i.isActive) return null
    return {
      lineType: i.type,
      id: i.id,
      type: 'INVENTORY',
      name: i.description || i.code,
      aliases: i.aliases,
      department: i.department,
      dailyRate: Number(i.dailyRate),
      weeklyRate: Number(i.weeklyRate),
    }
  }
  // Parses stored before the merge hold an AssetCategory id. Translate
  // it to the merged row rather than reading the frozen table, so an
  // old draft re-prices at today's rate.
  const mergedId = await catalogIdForAssetCategory(id)
  if (!mergedId) return null
  const merged = await prisma.inventoryItem.findUnique({
    where: { id: mergedId },
    select: {
      id: true, code: true, description: true, aliases: true,
      department: true, dailyRate: true, weeklyRate: true, type: true,
    },
  })
  if (!merged) return null
  return {
    id: merged.id,
    type: 'INVENTORY',
    name: merged.description || merged.code,
    aliases: merged.aliases,
    department: merged.department,
    dailyRate: Number(merged.dailyRate),
    weeklyRate: Number(merged.weeklyRate),
    lineType: merged.type,
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((t) => (t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t))
}

/**
 * Strip negative-qualifier phrases ("no X", "without X", "excluding X",
 * "minus X") from the description before matching, so an item like
 * "walkies, no surveillances" doesn't false-match against Surveillance Kit
 * just because the alias "surveillance" appears in the exclusion clause.
 *
 * The AI prompt already separates qualifier from description, so this is
 * defensive cleanup for cases where the AI hands us a fused description.
 */
function stripNegativeQualifiers(s: string): string {
  return s
    .replace(/[,;]\s*(?:no|without|excluding|minus|but no)\b[^,;]*/gi, '')
    .replace(/\s*\((?:no|without|excluding|minus|but no)\b[^)]*\)/gi, '')
    .trim()
}

/**
 * Server-side fallback: when the AI returns catalogProductId=null for a
 * line item, scan the FULL catalog (every alias on every product, plus
 * product names tokenized) for a single unambiguous hit.
 *
 *   - Aliases are checked as substrings (case-insensitive). An alias hit
 *     is a strong signal — score = aliasLength.
 *   - Product names contribute weaker signal — name tokens that overlap
 *     the description score 1 each.
 *   - If exactly one product has score > 0 (or one product clearly leads
 *     by >2x over the runner-up), return it. Otherwise null.
 *
 * This stays conservative on purpose — false positives on the catalog
 * ID are worse than leaving it null (the user gets an amber "no match"
 * prompt and picks one).
 */
export async function fallbackMatch(description: string): Promise<CatalogProduct | null> {
  const cleaned = stripNegativeQualifiers(description)
  const desc = cleaned.toLowerCase().trim()
  if (!desc) return null
  const descTokens = new Set(tokenize(desc))

  const invItems = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: {
      id: true, code: true, description: true, aliases: true, department: true,
      dailyRate: true, weeklyRate: true, type: true,
    },
  })

  type Scored = { product: CatalogProduct; score: number }
  const scores: Scored[] = []

  const scoreOne = (
    product: CatalogProduct,
    name: string,
    aliases: string[]
  ): Scored | null => {
    let score = 0
    for (const a of aliases) {
      const al = a.toLowerCase().trim()
      if (al && desc.includes(al)) score += al.length
    }
    const nameTokens = tokenize(name)
    for (const nt of nameTokens) {
      if (descTokens.has(nt)) score += 1
    }
    if (score === 0) return null
    return { product, score }
  }

  for (const i of invItems) {
    const name = i.description || i.code
    const product: CatalogProduct = {
      lineType: i.type,
      id: i.id,
      type: 'INVENTORY',
      name,
      aliases: i.aliases,
      department: i.department,
      dailyRate: Number(i.dailyRate),
      weeklyRate: Number(i.weeklyRate),
    }
    const s = scoreOne(product, name, i.aliases)
    if (s) scores.push(s)
  }

  if (scores.length === 0) return null

  // Sort by score desc; tie-break by preferring non-UTAH (LA-region default)
  // then shorter name (more general). Tie-break is what unblocks "walkies"
  // when 4 CP200 variants score identically — we deterministically pick the
  // LA Analog variant instead of returning null.
  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const aUtah = a.product.name.toUpperCase().startsWith('UTAH')
    const bUtah = b.product.name.toUpperCase().startsWith('UTAH')
    if (aUtah !== bUtah) return aUtah ? 1 : -1
    return a.product.name.length - b.product.name.length
  })
  if (scores.length === 1) return scores[0].product
  // Top wins outright if it beats #2 by 2x OR if it's tied with #2 but our
  // deterministic tiebreaker (above) put it first. Guards against close-but-
  // ambiguous cases like "lift" matching both Liftgate Van and Scissor Lift.
  if (scores[0].score >= scores[1].score * 2) return scores[0].product
  if (scores[0].score === scores[1].score) return scores[0].product
  return null
}
