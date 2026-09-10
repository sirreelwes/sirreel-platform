/**
 * Where partner-supplied units sit on the public /vehicles catalog, by
 * category — the registry behind the PartnerCatalogSection enum.
 *
 * Until 2026-09-10 there was ONE partner section, "Motorhomes & Location
 * Trailers", because there was one partner (King Kong). PowerTrip Rentals
 * brings generators, distro, HVAC, lifts and temporary lighting, none of
 * which is a motorhome, so the section is now a property of the unit
 * (SubcontractedVehicle.catalogSection, defaulting to the vendor's) and the
 * page renders one section per category that has a listed unit.
 *
 * Every section keeps the two rules the original one had: partners render
 * side by side inside it, and no vendor is ever named — the client sees a
 * SirReel category.
 *
 * Plain module on purpose (no Prisma import): the roster page's <select>
 * and the partner panel are client components and read the same list.
 */

export type PartnerCatalogSectionKey =
  | 'LOCATION_VEHICLES'
  | 'POWER_GENERATORS'
  | 'CABLES_DISTRO'
  | 'HVAC'
  | 'LIFTS'
  | 'LIGHTING'
  | 'CARTS'

export interface PartnerSectionMeta {
  key: PartnerCatalogSectionKey
  /** Section heading on /vehicles. */
  title: string
  /** Short label for HQ pickers. */
  short: string
  /** One-paragraph blurb under the heading. */
  blurb: string
  /** Fragment id, so the nav and emails can deep-link a section. */
  anchor: string
  /** What the detail page's CTA calls the thing. */
  noun: string
  /** Render order on the page; the owned fleet always comes first. */
  order: number
}

export const PARTNER_SECTIONS: readonly PartnerSectionMeta[] = [
  {
    key: 'LOCATION_VEHICLES',
    title: 'Motorhomes & Location Trailers',
    short: 'Motorhomes & trailers',
    blurb: 'Talent motorhomes, star wagons and location trailers for when the cast needs a real room on set. Rates and availability on quote; pick one to see the gallery and specs.',
    anchor: 'motorhomes-trailers',
    noun: 'vehicle',
    order: 10,
  },
  {
    key: 'POWER_GENERATORS',
    title: 'Power & Generators',
    short: 'Power & generators',
    blurb: 'Studio-quiet towable and portable generators from 2 kW up, delivered, cabled and fueled to your location. Sized to the load with you; pick one to see the specs.',
    anchor: 'power',
    noun: 'generator',
    order: 20,
  },
  {
    key: 'CABLES_DISTRO',
    title: 'Cable & Distro',
    short: 'Cable & distro',
    blurb: 'Feeder, banded and Bates cable, distro boxes and lunch boxes to get the power from the generator to the set.',
    anchor: 'distro',
    noun: 'package',
    order: 30,
  },
  {
    key: 'HVAC',
    title: 'Heating & Cooling',
    short: 'HVAC',
    blurb: 'Portable air conditioning, heaters and air handlers for stages, tents and location interiors, delivered and set up.',
    anchor: 'hvac',
    noun: 'unit',
    order: 40,
  },
  {
    key: 'LIFTS',
    title: 'Lifts & Material Handling',
    short: 'Lifts',
    blurb: 'Scissor lifts, boom lifts, telehandlers and forklifts for rigging and set construction, delivered to the location.',
    anchor: 'lifts',
    noun: 'lift',
    order: 50,
  },
  {
    key: 'LIGHTING',
    title: 'Temporary Lighting',
    short: 'Lighting',
    blurb: 'Light towers and work lighting for base camp, parking and night exteriors.',
    anchor: 'lighting',
    noun: 'unit',
    order: 60,
  },
  {
    key: 'CARTS',
    title: 'Carts',
    short: 'Carts',
    blurb: 'Golf carts and flat-bed carts for moving crew and gear around a location.',
    anchor: 'carts',
    noun: 'cart',
    order: 70,
  },
] as const

export const DEFAULT_PARTNER_SECTION: PartnerCatalogSectionKey = 'LOCATION_VEHICLES'

const BY_KEY: Record<string, PartnerSectionMeta> = Object.fromEntries(PARTNER_SECTIONS.map((s) => [s.key, s]))

export function partnerSection(key: string | null | undefined): PartnerSectionMeta {
  return BY_KEY[key ?? ''] ?? BY_KEY[DEFAULT_PARTNER_SECTION]
}

export function isPartnerSectionKey(v: unknown): v is PartnerCatalogSectionKey {
  return typeof v === 'string' && v in BY_KEY
}

/** Unit override wins, then the vendor's default. */
export function resolvePartnerSection(
  unit: { catalogSection: string | null } | null | undefined,
  vendor: { catalogSection: string | null } | null | undefined,
): PartnerSectionMeta {
  return partnerSection(unit?.catalogSection ?? vendor?.catalogSection ?? null)
}
