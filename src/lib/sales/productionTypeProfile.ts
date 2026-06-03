/**
 * ProductionType enum → ProductionTypeProfile slug.
 *
 * The legacy `ProductionType` enum (FILM / TV / COMMERCIAL / ...) is
 * the agent-facing category an agent picks on a Job or Quote. The
 * `ProductionTypeProfile` lookup row carries the structured
 * tier (1–5) + salesMode + upsellPropensity + priceSensitivity used
 * by the HQ AI routing logic. Tier is INFORMATIVE TO THE AI ONLY —
 * agents never pick it; it's derived from the production type they
 * already chose.
 *
 * Mapping (matches prisma/seeds/productionTypeProfiles.ts):
 *   FILM         → feature      (tier 2)
 *   TV           → episodic-tv  (tier 3)
 *   COMMERCIAL   → commercial   (tier 5)
 *   MUSIC_VIDEO  → music-video  (tier 4)
 *   CORPORATE    → corporate    (tier 5)
 *   EVENT_PLANNER → null  — no clean profile match
 *   OTHER        → null  — no clean profile match
 *
 * The omitted enum values resolve to `null` so `Job.productionType
 * ProfileId` stays nullable on save. Downstream HQ AI handles those
 * via `Job.productionType` alone.
 *
 * FILM → feature (not indie) because Indie is a budget-flag
 * refinement, not a separate category in the agent's mental model.
 * Both Feature and Indie are tier 2, so the routing tier is
 * unambiguous either way.
 */
import type { ProductionType } from '@prisma/client'

export const PRODUCTION_TYPE_TO_PROFILE_SLUG: Partial<Record<ProductionType, string>> = {
  FILM: 'feature',
  TV: 'episodic-tv',
  COMMERCIAL: 'commercial',
  MUSIC_VIDEO: 'music-video',
  CORPORATE: 'corporate',
  // EVENT_PLANNER and OTHER intentionally omitted.
}

/**
 * Resolve a profile id from a production type using a previously-
 * loaded slug-to-id map. Returns null when the production type has
 * no clean profile match or when the map hasn't loaded yet.
 */
export function deriveProfileIdFromProductionType(
  productionType: ProductionType,
  slugToId: Record<string, string>,
): string | null {
  const slug = PRODUCTION_TYPE_TO_PROFILE_SLUG[productionType]
  if (!slug) return null
  return slugToId[slug] ?? null
}
