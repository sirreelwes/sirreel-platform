/**
 * Public supply form — curated section mapping (display-only).
 *
 * The public form does NOT mirror the internal InventoryCategory list.
 * It renders exactly these sections, in exactly this order, each fed by
 * one or more category slugs. Anything in a category that isn't mapped
 * here simply doesn't render publicly — even when publicVisible=true.
 * (The API's publicVisible gate still applies first; this layer only
 * decides sectioning and public exposure of mapped categories.)
 *
 * Cross-listing: some items belong in more than one section from the
 * client's point of view (Director's Chairs read as both basecamp
 * furniture and a wardrobe/HMU staple). Cross-listed items render in
 * every listed section but keep ONE identity — the cart keys on
 * itemId, so adding from either section lands on the same cart line.
 *
 * Internal surfaces (builder, typeahead, admin) never read this file.
 */

export interface PublicSupplySection {
  label: string
  slugs: string[]
  /** Item-level membership by EXACT catalog name — for curated
   *  sections whose gear is scattered across categories (Client/VIP).
   *  Item-listed items ADD to this section on top of any slug-based
   *  home; the shared itemId keeps one cart identity. */
  itemNames?: string[]
}

// A slug may appear under MORE THAN ONE section — those items render
// in every listing section (e.g. tables-chairs shows in both Basecamp
// Basics and Lunch and Crafty) while keeping one cart identity.
export const PUBLIC_SUPPLY_SECTIONS: PublicSupplySection[] = [
  { label: 'Basecamp Basics', slugs: ['basecamp-basics', 'tables-chairs'] },
  { label: 'Power and Lighting', slugs: ['lighting-electric'] },
  { label: 'Safety & Traffic', slugs: ['safety-traffic'] },
  { label: 'Radios & WiFi', slugs: ['communications'] },
  { label: 'Lunch and Crafty', slugs: ['craft-services-catering', 'tables-chairs'] },
  { label: 'Wardrobe & Makeup', slugs: ['wardrobe-makeup'] },
  { label: 'Tools & Cleaning', slugs: ['tools-cleaning'] },
  // Client/VIP — lounge-furniture gear scattered across categories by
  // the RW import; membership is item-level (approved list, Wes
  // 2026-07-05 — see docs/cleanup/2026-07-05-client-vip-flags.csv).
  {
    label: 'Client/VIP',
    slugs: [],
    itemNames: [
      'Bar StoolLow Back (BlackLeather)',
      'Client Lounge, SOLO Line',
      'Client Lounge, Standard',
      'POSING STOOL, ROLLING',
      "Pipe & Drape - BlackVelour - 10'H x 10'W",
      'Pipe & Drape -Base',
      "Pipe & Drape -Black Drape 12'wide x 10'Tall",
      "Pipe & Drape -Black Drape 22'wide x 10'Tall",
      "Pipe & Drape -Black Drape 8'wide x 8'Tall",
      "Pipe & Drape -Red Velour -10' H x 10'W",
      'Pipe & Drape -Spreader',
      'Pipe & Drape -Upright',
      'SOFA - COSMOPOLITAN, BLACK 7\' x 35"',
      'SOLO Line - End Table (Each)',
      'SOLO Line - Single Chair',
      'SOLO Line - Sofa',
      'SOLO Line- CoffeeTable',
      'SOLO Line- FloorLamp',
      'SOLO Line- Rug',
      'SOLO Line- TableLamp (Each)',
      'Standard 1 Line - Table Lamp',
      'Standard 1 Line -Coffee Table',
      'Standard 1 Line -End Table (Each)',
      'Standard 1 Line -Floor Lamp',
      'Standard 1 Line -Love Seat',
      'Standard 1 Line -Single Chair',
      'Standard 1 Line -Sofa',
      'Standard 2 Line -Coffee Table',
      'Standard 2 Line -End Table',
      'Standard 2 Line -Floor Lamp',
      'Standard 2 Line -Love Seat',
      'Standard 2 Line -Sofa',
      'Standard 2 Line -Table Lamp',
    ],
  },
]

// Cross-list rules — name-matched items appear in the listed sections
// INSTEAD of their home section. Keep patterns tight: a "Director's
// Chair Rack" is transport gear, not a chair, so the pattern requires
// the name NOT to contain "rack".
export interface CrossListRule {
  match: (name: string) => boolean
  sections: string[]
}

export const CROSS_LIST_RULES: CrossListRule[] = [
  {
    match: (name) => /director'?s?\s+chairs?\b/i.test(name) && !/rack/i.test(name),
    sections: ['Basecamp Basics', 'Wardrobe & Makeup'],
  },
]

export interface SectionedItem<T> {
  label: string
  items: T[]
}

/**
 * Pure mapper: API catalog categories (keyed by slug) → the curated
 * public sections. Used by SupplyOrderApp; safe for client bundles.
 *
 * - Sections render in PUBLIC_SUPPLY_SECTIONS order; empty sections
 *   are dropped.
 * - Cross-list rules move matching items into their target sections
 *   (deduped by id within a section).
 * - Items whose category slug maps to no section are dropped.
 */
export function mapCatalogToSections<T extends { id: string; name: string; category: string }>(
  categories: Array<{ slug: string; items: T[] }>,
): SectionedItem<T>[] {
  const bySlug = new Map(categories.map((c) => [c.slug, c.items]))
  const sections = new Map<string, Map<string, T>>()
  for (const s of PUBLIC_SUPPLY_SECTIONS) sections.set(s.label, new Map())

  // slug → every section that lists it (multi-home cross-listing).
  const labelsBySlug = new Map<string, string[]>()
  for (const s of PUBLIC_SUPPLY_SECTIONS) {
    for (const slug of s.slugs) {
      labelsBySlug.set(slug, [...(labelsBySlug.get(slug) ?? []), s.label])
    }
  }

  // Item-level membership (Client/VIP-style curated lists) — exact
  // catalog-name match, additive on top of slug/rule placement.
  const itemNameSections = new Map<string, string[]>()
  for (const s of PUBLIC_SUPPLY_SECTIONS) {
    for (const n of s.itemNames ?? []) {
      itemNameSections.set(n, [...(itemNameSections.get(n) ?? []), s.label])
    }
  }

  for (const [slug, items] of bySlug) {
    for (const it of items) {
      for (const label of itemNameSections.get(it.name) ?? []) {
        sections.get(label)?.set(it.id, it)
      }
      const rule = CROSS_LIST_RULES.find((r) => r.match(it.name))
      if (rule) {
        // Name rules OVERRIDE slug placement entirely.
        for (const label of rule.sections) sections.get(label)?.set(it.id, it)
        continue
      }
      for (const label of labelsBySlug.get(slug) ?? []) {
        sections.get(label)?.set(it.id, it)
      }
    }
  }

  return PUBLIC_SUPPLY_SECTIONS
    .map((s) => ({
      label: s.label,
      items: [...(sections.get(s.label)?.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((s) => s.items.length > 0)
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Rank search results across the FULL publicVisible catalog — search
 * ignores section mapping (typing intent beats browse curation), so
 * items from unmapped categories surface here and are addable.
 *
 * Tiering (mirrors the spirit of the internal typeahead: name evidence
 * outranks weaker matches; the API has already alias/code/category-
 * filtered the set, so a non-name hit means "matched via alias/code/
 * category only"):
 *   0 — name starts with the query        ("Table…" for "table")
 *   1 — query at a word boundary in name  ("Folding Table")
 *   2 — query as a substring in name      ("Turntable")
 *   3 — name doesn't contain it           (alias/code/category match)
 * Alphabetical within each tier.
 */
export function rankSearchResults<T extends { id: string; name: string }>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  const word = new RegExp(`\\b${escapeRegExp(q)}`, 'i')
  const tier = (name: string): number => {
    const n = name.toLowerCase()
    if (n.startsWith(q)) return 0
    if (word.test(name)) return 1
    if (n.includes(q)) return 2
    return 3
  }
  const seen = new Set<string>()
  return items
    .filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)))
    .map((it) => ({ it, t: tier(it.name) }))
    .sort((a, b) => a.t - b.t || a.it.name.localeCompare(b.it.name))
    .map((x) => x.it)
}
