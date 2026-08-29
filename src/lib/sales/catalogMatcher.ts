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
    'WARDROBE_MAKEUP',
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

/**
 * Split a name or description into comparable word tokens.
 *
 * Hyphenated words also yield their parts ("first-aid" → first-aid, first,
 * aid) — the catalog writes "First Aid Kit" while clients write "first-aid
 * kit", and keeping only the fused token made those two share nothing.
 */
/**
 * The description's own words, in order and unexpanded. This is the set the
 * coverage test measures against — and its last member is the head noun, the
 * thing actually being asked for ("chargers" in "multi-bank walkie chargers").
 */
function singularize(t: string): string {
  return t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t
}

/**
 * A search token plus the singular forms of it, for callers matching against
 * catalog text with plain `contains`.
 *
 * SirReel names things in the singular ("Table, 6' Folding") and crews ask in
 * the plural ("6' folding tables"), so a literal token match drops the very
 * row the rep is looking for — which is what left the line-item picker
 * showing nothing at all for "6' folding tables".
 */
/**
 * Every way a crew might WRITE the same measurement.
 *
 * The catalog names a table "Table, 4' Folding"; a rep types "4ft table" and
 * the search — which is `contains` per token — finds nothing, because "4ft"
 * is not a substring of "4'". extractSpecs() already normalises these for the
 * AI/fallback matcher, but the typeahead never saw that, so the two disagreed
 * about the same catalog.
 *
 * Feet and inches are the ones that actually bite (tables, drape, ladders);
 * the rest are here because the same mismatch exists for coolers and
 * generators the moment someone types "100qt" against "100 qt".
 */
const MEASURE_UNITS: Array<{ match: RegExp; spellings: (n: string) => string[] }> = [
  {
    match: /^(\d+(?:\.\d+)?)\s*-?\s*(?:'|ft|foot|feet)$/,
    spellings: (n) => [`${n}'`, `${n}ft`, `${n} ft`, `${n}-ft`, `${n} foot`, `${n}-foot`, `${n}feet`, `${n} feet`],
  },
  {
    // Inches BEFORE feet would be wrong the other way round: 6'' is inches.
    match: /^(\d+(?:\.\d+)?)\s*-?\s*(?:''|"|in|inch|inches)$/,
    spellings: (n) => [`${n}"`, `${n}''`, `${n}in`, `${n} in`, `${n}-in`, `${n} inch`, `${n}-inch`, `${n}inches`],
  },
  {
    match: /^(\d+(?:\.\d+)?)\s*-?\s*(?:qt|quart|quarts)$/,
    spellings: (n) => [`${n}qt`, `${n} qt`, `${n}-qt`, `${n} quart`, `${n}quart`],
  },
  {
    match: /^(\d+(?:\.\d+)?)\s*-?\s*(?:gal|gallon|gallons)$/,
    spellings: (n) => [`${n}gal`, `${n} gal`, `${n}-gal`, `${n} gallon`, `${n}gallon`],
  },
  {
    match: /^(\d+(?:\.\d+)?)\s*-?\s*(?:w|watt|watts)$/,
    spellings: (n) => [`${n}w`, `${n} w`, `${n}-w`, `${n} watt`, `${n}watt`],
  },
]

/** Alternate spellings for a measurement token, or [] when it isn't one. */
export function measureVariants(t: string): string[] {
  const base = t.toLowerCase().trim()
  for (const { match, spellings } of MEASURE_UNITS) {
    const m = base.match(match)
    if (m) return spellings(String(parseFloat(m[1])))
  }
  return []
}

/**
 * Fold "4 ft table" into ["4ft", "table"] before the per-token search runs.
 *
 * Without this the bare "ft" is its own token, and since EVERY token has to
 * hit something, one stray unit word empties the dropdown — the same failure
 * mode the plural handling below was written for.
 */
export function mergeMeasureTokens(tokens: string[]): string[] {
  const UNIT_WORD = /^(?:'|''|"|ft|foot|feet|in|inch|inches|qt|quart|quarts|gal|gallon|gallons|w|watt|watts)$/i
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i]
    const next = tokens[i + 1]
    if (/^\d+(?:\.\d+)?$/.test(cur) && next && UNIT_WORD.test(next)) {
      out.push(`${cur}${next.toLowerCase()}`)
      i++
    } else {
      out.push(cur)
    }
  }
  return out
}

export function tokenVariants(t: string): string[] {
  const base = t.toLowerCase()
  const out = new Set([base])
  // Measurement first: "4ft" has no plural, and singularize() would only
  // mangle it.
  const measures = measureVariants(base)
  if (measures.length) {
    for (const m of measures) out.add(m)
    return [...out]
  }
  if (base.length > 3 && base.endsWith('ies')) out.add(`${base.slice(0, -3)}y`)
  if (base.length > 4 && base.endsWith('es')) out.add(base.slice(0, -2))
  out.add(singularize(base))
  return [...out]
}

function primaryTokens(s: string): string[] {
  return stripSpecs(s)
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    // A token that is just a number, with or without a unit ("25", "6ft",
    // "100qt", "2000w"), carries no meaning as a word: it's either a spec —
    // handled by the gate below, which compares specs properly — or part-
    // number debris. Left in, it both scored bogus points ("10' table"
    // matching "Pipe & Drape ... 10'H x 10'W") and diluted the coverage
    // test, since "6ft tables" would count a token no name can explain.
    .filter((t) => !/^\d+(?:\.\d+)?[a-z]*$/.test(t))
    .map(singularize)
}

function tokenize(s: string): string[] {
  const out: string[] = []
  const raw = primaryTokens(s)
  for (const t of raw) {
    out.push(t)
    if (t.includes('-')) {
      for (const part of t.split('-')) {
        if (part.length >= 2 && !/^\d+(?:\.\d+)?[a-z]*$/.test(part)) out.push(singularize(part))
      }
    }
  }
  return out
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
 * Pull dimension/capacity specs ("6'", "6-foot", "30\"", "100 qt", "2000W")
 * out of a string, normalized to `6ft` / `30in` / `100qt` / `2000w`.
 *
 * These are invisible to tokenize(): the apostrophe becomes a space and the
 * bare number is dropped. Yet for whole families of catalog rows the spec is
 * the ONLY thing that distinguishes them — Table, 4'/6'/8' Folding,
 * Cooler 68/100 qt, Generator 2000W/7000W are otherwise identical strings.
 * Without this, every member scored the same and the shortest-name tiebreak
 * below handed back an arbitrary one at the wrong daily rate ("8' folding
 * table" resolved to Table, 6' Folding; "100 qt cooler" to Cooler, 68 qt).
 */
const SPEC_PATTERNS: Array<[RegExp, string]> = [
  // Inches first — 6'' must not read as 6 feet.
  [/(\d+(?:\.\d+)?)[\s-]*(?:''|"|in\b|inch(?:es)?\b)/g, 'in'],
  [/(\d+(?:\.\d+)?)[\s-]*(?:'|ft\b|foot\b|feet\b)/g, 'ft'],
  [/(\d+(?:\.\d+)?)[\s-]*(?:qt\b|quart(?:s)?\b)/g, 'qt'],
  [/(\d+(?:\.\d+)?)[\s-]*(?:gal\b|gallon(?:s)?\b)/g, 'gal'],
  [/(\d+(?:\.\d+)?)[\s-]*(?:lb(?:s)?\b|pound(?:s)?\b)/g, 'lb'],
  [/(\d+(?:\.\d+)?)[\s-]*ton(?:s)?\b/g, 'ton'],
  [/(\d+(?:\.\d+)?)[\s-]*w(?:att(?:s)?)?\b/g, 'w'],
  [/(\d+(?:\.\d+)?)[\s-]*amp(?:s)?\b/g, 'amp'],
  // Lighting shorthand — a 2K and a 5K are different fixtures at different
  // rates. Deliberately no bare `a` for amps: "2 A-Frame" would read as 2 amps.
  [/(\d+(?:\.\d+)?)[\s-]*k\b/g, 'k'],
]

export function extractSpecs(s: string): Set<string> {
  const out = new Set<string>()
  const lower = s.toLowerCase()
  for (const [re, unit] of SPEC_PATTERNS) {
    for (const m of lower.matchAll(re)) out.add(`${parseFloat(m[1])}${unit}`)
  }
  return out
}

/**
 * Remove spec phrases so tokenize() never sees their debris. "6-foot folding
 * tables" would otherwise yield the word tokens "6-foot" and "foot", which no
 * catalog name can explain, dragging the coverage test below its floor and
 * rejecting the very row the spec gate had just isolated.
 */
function stripSpecs(s: string): string {
  let out = s.toLowerCase()
  for (const [re] of SPEC_PATTERNS) out = out.replace(re, ' ')
  return out
}

function specsOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true
  return false
}

/**
 * Does `alias` appear in `desc` as a whole word (allowing a trailing plural)?
 *
 * Substring matching was the original rule and it was quietly catastrophic
 * for the short curated aliases: "ac" (Air Conditioner) fired inside
 * "garment racks", scoring higher than any real candidate and pricing a
 * clothes rack at the AC's $150/day.
 */
function aliasHit(desc: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:e?s)?(?:$|[^a-z0-9])`, 'i').test(desc)
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
 *   - Physical size is a GATE, not a score: when the description names a
 *     size, rows whose own size disagrees are dropped outright, and if any
 *     row's size agrees, only those rows compete. Scoring alone can't do
 *     this — a size token contributes nothing to the token overlap, so
 *     4'/6'/8' variants score identically and the tiebreak picks blind.
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
  const descSpecs = extractSpecs(desc)
  // Coverage is measured against the words the client actually wrote, not the
  // hyphen-split expansions — "heavy-duty" is one ask, not three.
  const descPrimary = primaryTokens(desc)
  const primarySet = new Set(descPrimary)
  const descHead = descPrimary[descPrimary.length - 1] ?? null

  const invItems = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: {
      id: true, code: true, description: true, aliases: true, department: true,
      dailyRate: true, weeklyRate: true, type: true,
    },
  })

  type Scored = {
    product: CatalogProduct
    score: number
    /** Had at least one curated alias hit — evidence in its own right. */
    aliased: boolean
    /** Share of the description's own tokens this row accounts for. */
    coverage: number
    /** Explains the head noun — the thing being asked for, not a modifier. */
    headExplained: boolean
    specs: Set<string>
  }
  const scores: Scored[] = []

  const scoreOne = (
    product: CatalogProduct,
    name: string,
    aliases: string[]
  ): Scored | null => {
    let score = 0
    let aliased = false
    // Desc tokens this row explains — via its name or via a hit alias.
    const explained = new Set<string>()
    for (const a of aliases) {
      const al = a.toLowerCase().trim()
      if (!al || !aliasHit(desc, al)) continue
      score += al.length
      aliased = true
      for (const at of tokenize(al)) if (descTokens.has(at)) explained.add(at)
    }
    for (const nt of new Set(tokenize(name))) {
      // Deduped: "Fan, \"RE Fan\" w/stand" scored 2 on "fans" purely by
      // saying "fan" twice, outranking the plain utility fan.
      if (descTokens.has(nt)) {
        score += 1
        explained.add(nt)
      }
    }
    if (score === 0) return null
    // A hyphenated word counts as explained when its parts are: the catalog
    // writes "First Aid Kit", the client writes "first-aid kit", and the two
    // agree on every word that matters.
    const covers = (t: string): boolean => {
      if (explained.has(t)) return true
      if (!t.includes('-')) return false
      const parts = t.split('-').filter((x) => x.length >= 2).map(singularize)
      return parts.length > 0 && parts.every((x) => explained.has(x))
    }
    const explainedPrimary = [...primarySet].filter(covers)
    return {
      product,
      score,
      aliased,
      coverage: primarySet.size > 0 ? explainedPrimary.length / primarySet.size : 0,
      headExplained: descHead !== null && covers(descHead),
      // Aliases can carry the spec the name leaves implicit ("6 foot table"
      // on a row named "Banquet Table"), so the row's specs are the union.
      specs: extractSpecs([name, ...aliases].join(' ')),
    }
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

  // Spec gate. A description that names a spec ("6' folding tables", "100 qt
  // cooler") can only mean rows of that spec: drop every row that declares a
  // different one, and once any row declares the right one, unspecced rows
  // stop competing too — otherwise a generic "6' tables" loses to whatever
  // sizeless table happens to have the shortest name.
  let pool = scores
  if (descSpecs.size > 0) {
    const compatible = scores.filter(
      (s) => s.specs.size === 0 || specsOverlap(s.specs, descSpecs)
    )
    const sameSpec = compatible.filter((s) => specsOverlap(s.specs, descSpecs))
    pool = sameSpec.length > 0 ? sameSpec : compatible
    if (pool.length === 0) return null
  }

  // Sort by score desc; tie-break by preferring non-UTAH (LA-region default)
  // then shorter name (more general). Tie-break is what unblocks "walkies"
  // when 4 CP200 variants score identically — we deterministically pick the
  // LA Analog variant instead of returning null.
  pool.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const aUtah = a.product.name.toUpperCase().startsWith('UTAH')
    const bUtah = b.product.name.toUpperCase().startsWith('UTAH')
    if (aUtah !== bUtah) return aUtah ? 1 : -1
    return a.product.name.length - b.product.name.length
  })

  const top = pool[0]
  // Evidence test, applied before any winner is declared. Either the row
  // accounts for most of what the client said, or a curated alias lands on
  // the head noun — the thing being asked for.
  //
  // Both halves earn their keep. Without the coverage floor, one shared
  // generic token won a whole category: "rolling utility / production carts"
  // came back as Director's Chair Cart, Rolling on the strength of "cart".
  // Without the head-noun rule, an alias firing on a modifier did the same
  // damage in reverse: "Multi-bank walkie chargers" and "Spare walkie
  // batteries" both matched the RADIO on the word "walkie" and billed the
  // client $10/day each for accessories that ship free.
  if (top.coverage < 0.6 && !(top.aliased && top.headExplained)) return null
  if (pool.length === 1) return top.product

  const runnerUp = pool[1]
  // Tied with #2 — the deterministic tiebreaker above already put the
  // preferred row first (LA over UTAH, more general over more specific).
  if (top.score === runnerUp.score) return top.product
  // Top wins outright if it beats #2 by 2x. Guards against close-but-
  // ambiguous cases like "lift" matching both Liftgate Van and Scissor Lift.
  if (top.score >= runnerUp.score * 2) return top.product
  // Narrower lead: only when the top also explains strictly more of the
  // description than #2 does — "large trash cans + liners" leads Trash
  // Liners 3-2, and it's the one that accounts for "large" and "cans".
  if (top.coverage > runnerUp.coverage) return top.product
  return null
}

