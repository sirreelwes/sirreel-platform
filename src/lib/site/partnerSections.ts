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
 * RENAMED 2026-09-10 (Wes: "motorhomes and wardrobe makeup trailers are all
 * going to be in the Specialty Vehicles category"). The section had been
 * named after its contents — motorhomes and location trailers — while the
 * signed rental agreement and the quote's own mileage term had always called
 * the class Specialty Vehicles. Two names for one thing, one of them on the
 * contract. The contract's name wins, and the section now holds the wardrobe,
 * hair/makeup, honeywagon and restroom trailers with the coaches.
 *
 * The class is also a BILLING class, not just a heading: no LCDW, mileage per
 * mile from the first mile, calendar days with no weekly cap. That side lives
 * in `src/lib/pricing/specialtyVehicles.ts` — keep the two in step.
 *
 * PHOTO SHOOT RENTALS (2026-09-11, Wes: "for VSM planet, photo shoot rentals is
 * going to be a new class of rentals") is the second section that is also a
 * billing class: it is a LineItemDepartment too, so a partner unit in it
 * quotes under its own section and subtotal — see partnerUnitDepartment().
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
  | 'PHOTO_SHOOT'

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
    // The ENUM KEY stays LOCATION_VEHICLES on purpose. It is a Postgres
    // enum with rows pointing at it; renaming the value costs a two-deploy
    // dance (code first, then data) to change a heading. The title is what
    // anyone reads — see the header note on the rename.
    key: 'LOCATION_VEHICLES',
    title: 'Specialty Vehicles',
    short: 'Specialty vehicles',
    blurb: 'Talent motorhomes, star wagons, honeywagons, wardrobe and hair/makeup trailers, production trailers and restroom trailers — the units that give cast and crew a real room on location. Delivered, set and serviced; rates and availability on quote.',
    anchor: 'specialty-vehicles',
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
  {
    key: 'PHOTO_SHOOT',
    title: 'Photo Shoot Rentals',
    short: 'Photo shoot',
    blurb: 'Strobes and light modifiers, cameras, seamless and painted backdrops, stands and grip for stills and studio shoots — packaged for the shoot and ready for pickup or delivery.',
    anchor: 'photo-shoot',
    noun: 'item',
    order: 80,
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

/**
 * The quote department a partner's unit bills under. Partner units carry no
 * LineItemDepartment of their own, so it is read off the section first —
 * Photo Shoot Rentals is a department as well as a section (Wes 2026-09-11) —
 * and otherwise off the partner's kind.
 */
export function partnerUnitDepartment(
  unit: { catalogSection: string | null } | null | undefined,
  vendor: { catalogSection: string | null; partnerKind: string | null } | null | undefined,
): 'PHOTO_SHOOT' | 'GE' | 'VEHICLES' {
  if (resolvePartnerSection(unit, vendor).key === 'PHOTO_SHOOT') return 'PHOTO_SHOOT'
  return vendor?.partnerKind === 'EQUIPMENT' ? 'GE' : 'VEHICLES'
}
