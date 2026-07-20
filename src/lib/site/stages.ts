/**
 * Stage areas for the public /stages page. A small curated set (not the
 * growing Space catalog), so it lives here as content — easy to edit, and
 * straightforward to move to admin-managed Space rows later if desired.
 *
 * Specs/amenities mirror the current sirreel.com studio listings.
 * "Standing Sets" is a card that links out to the existing /standing-sets
 * collection rather than a single detail page (hence `href`).
 */
export interface StageSpec {
  label: string
  value: string
}

export interface StageArea {
  slug: string
  name: string
  eyebrow: string
  /** "Ideal for" line. */
  idealFor: string
  /** Short line for the card. */
  blurb: string
  /** Longer copy for the detail page (whitespace-pre-line). */
  description: string
  specs: StageSpec[]
  /** External link instead of a /stages/[slug] detail (e.g. Standing Sets). */
  href?: string
  /** Optional public image path; falls back to the S-mark placeholder. */
  photo?: string
  cta?: string
}

export const STUDIO_ADDRESS = { line1: '8500 Lankershim Blvd', line2: 'Sun Valley, CA 91352' }

/** Facility-wide amenities shared across the stages. */
export const STUDIO_AMENITIES: { heading: string; items: string[] }[] = [
  { heading: 'Support', items: ['(2) VIP green rooms', '(2) multi-person restrooms', '(1) conference room w/ TV', '(2) loading docks'] },
  { heading: 'Features', items: ['Stage manager (12 hrs)', 'Parking — 17 spaces', 'Power — 100 amps', 'AC / heat + Wi-Fi', '(1) dumpster'] },
  { heading: 'Also on-site', items: ['(2) production offices', '(1) shared kitchen w/ refrigerator', '(1) outdoor patio'] },
]

export const STAGES: StageArea[] = [
  {
    slug: 'lankershim-sound-stage',
    photo: '/images/stages/sound-stage.jpg',
    name: 'Lankershim Sound Stage',
    eyebrow: 'Sound Stage',
    idealFor: 'Film, TV & commercial shoots',
    blurb: 'An 82′×57′ gridded sound stage — 4,674 sq ft with a full lighting grid.',
    description:
      'Our flagship gridded sound stage: an 82′ × 57′ × 17′ shooting floor at 4,674 sq ft with a full lighting grid. Drive-in access and two loading docks bring vehicles and set pieces straight onto the floor, with production offices, green rooms, and a shared kitchen steps away in the same building.',
    specs: [
      { label: 'Gridded stage', value: '82′ × 57′ × 17′' },
      { label: 'Floor area', value: '4,674 sq ft' },
      { label: 'Grid', value: 'Full lighting grid' },
      { label: 'Power', value: '100 amps' },
      { label: 'Access', value: 'Drive-in + 2 docks' },
      { label: 'Climate', value: 'AC / heat + Wi-Fi' },
    ],
  },
  {
    slug: 'led-volume-stage',
    photo: '/images/stages/led-volume.jpg',
    name: 'LED / Volume Stage',
    eyebrow: 'Virtual Production',
    idealFor: 'Large photo shoots, commercials, podcasts & music videos',
    blurb: 'A 40′×40′ two-wall white cyc set up as an LED volume for virtual production.',
    description:
      'A 40′ × 40′ × 17′ two-wall white cyc, configured as an LED volume for in-camera VFX — real-time backgrounds, interactive lighting, and reflections captured live on set. Great for driving shots, environments, commercials, podcasts, and music videos without a location move.\n\nLED wall configuration is set per production — reach out with your shoot and we’ll scope it.',
    specs: [
      { label: 'White cyc', value: '40′ × 40′ × 17′' },
      { label: 'Cyc walls', value: '2-wall' },
      { label: 'Use', value: 'LED volume / ICVFX' },
      { label: 'Config', value: 'Per production' },
    ],
    cta: 'Request specs & availability',
  },
  {
    slug: 'standing-sets',
    photo: '/images/stages/standing-sets.jpg',
    name: 'Standing Sets',
    eyebrow: 'Turnkey Sets',
    idealFor: 'TV shows, film shoots & commercials',
    blurb: 'Hospital, police station, jail, morgue & school — built and ready to shoot.',
    description:
      'Purpose-built, ready-to-shoot environments — hospital, police station, jail, morgue, and school — flowing into one another across 143′ × 57′ (8,151 sq ft) of gridded sets.',
    specs: [
      { label: 'Environments', value: 'Hospital · Police · Jail · Morgue · School' },
      { label: 'Gridded sets', value: '143′ × 57′ · 8,151 sq ft' },
      { label: 'State', value: 'Turnkey, ready to shoot' },
    ],
    href: '/standing-sets',
    cta: 'Browse the standing sets →',
  },
  {
    slug: 'black-box',
    photo: '/images/stages/black-box.jpg',
    name: 'Black Box',
    eyebrow: 'Flexible Stage',
    idealFor: 'Tabletop, product & controlled-lighting work',
    blurb: 'A 40′×50′ blacked-out flexible stage — 2,000 sq ft of full lighting control.',
    description:
      'A 40′ × 50′ × 17′ blacked-out, flexible stage — 2,000 sq ft built for total lighting control. Ideal for tabletop and product work, interviews, small builds, and anything that needs a clean, dark environment.',
    specs: [
      { label: 'Dimensions', value: '40′ × 50′ × 17′' },
      { label: 'Floor area', value: '2,000 sq ft' },
      { label: 'Finish', value: 'Blacked-out' },
      { label: 'Lighting', value: 'Full control' },
    ],
    cta: 'Request availability',
  },
]

export function getStage(slug: string): StageArea | undefined {
  return STAGES.find((s) => s.slug === slug)
}
