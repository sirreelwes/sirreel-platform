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
}

export const PUBLIC_SUPPLY_SECTIONS: PublicSupplySection[] = [
  { label: 'Basecamp Basics', slugs: ['basecamp-basics'] },
  { label: 'Power and Lighting', slugs: ['lighting-electric'] },
  { label: 'Safety & Traffic', slugs: ['safety-traffic'] },
  { label: 'Radios & WiFi', slugs: ['communications'] },
  { label: 'Lunch and Crafty', slugs: ['craft-services-catering', 'tables-chairs'] },
  { label: 'Wardrobe & Makeup', slugs: ['wardrobe-makeup'] },
  { label: 'Tools & Cleaning', slugs: ['tools-cleaning'] },
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

  const homeLabelBySlug = new Map<string, string>()
  for (const s of PUBLIC_SUPPLY_SECTIONS) for (const slug of s.slugs) homeLabelBySlug.set(slug, s.label)

  for (const [slug, items] of bySlug) {
    for (const it of items) {
      const rule = CROSS_LIST_RULES.find((r) => r.match(it.name))
      if (rule) {
        for (const label of rule.sections) sections.get(label)?.set(it.id, it)
        continue
      }
      const home = homeLabelBySlug.get(slug)
      if (home) sections.get(home)?.set(it.id, it)
    }
  }

  return PUBLIC_SUPPLY_SECTIONS
    .map((s) => ({
      label: s.label,
      items: [...(sections.get(s.label)?.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((s) => s.items.length > 0)
}
