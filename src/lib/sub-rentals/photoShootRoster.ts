/**
 * VSM Planet Rentals' starter roster — the gear behind the Photo Shoot
 * Rentals section.
 *
 * Wes 2026-09-11: "for VSM planet, photo shoot rentals is going to be a new
 * class of rentals." That shipped the CLASS — a LineItemDepartment and a
 * PartnerCatalogSection (`#photo-shoot`), a 3-day rental week for gear
 * SirReel carries there, a quote heading and a subtotal. What it did not
 * ship was anything IN it: the section on /vehicles renders only while a
 * signed partner has a LISTED unit in it, so Photo Shoot Rentals has been a
 * heading with nothing under it since the day it was added. This is the
 * gear (Wes 2026-09-16: "build the photo section for SirReel using VSM
 * gear").
 *
 * WHAT IS KNOWN vs WHAT IS PLACEHOLDER. VSM Planet Rentals is a Hollywood
 * studio-and-production rental house, 23 years in, ~500 rental types "from
 * cameras and backings to Sprinter van packages", and their own site says
 * they specialise in the PROFOTO line. That much is public and quotable.
 * The individual units below are the SHAPE of that catalog, not a stock
 * list read off their shelves — their site is blocked to us (the same
 * egress block the battery-partner research hit), so every seeded row
 * carries a staff-only note to confirm the exact model, pack size and rate
 * with Vic before quoting. Model detail is kept deliberately loose ("Pro
 * pack & head kit — 2400 W/s", not a SKU) so a confirmation call CORRECTS a
 * row rather than discovering it was invented.
 *
 * SPRINTER VANS ARE NOT HERE, on purpose. VSM rents loaded Sprinter
 * packages; SirReel rents cargo and passenger vans as its own fleet. Listing
 * their vans beside ours puts a partner in competition with the house
 * inventory, which is the GreenLite caveat over again. If Wes wants them,
 * they belong under Specialty Vehicles or Cars & SUVs, never under Photo
 * Shoot Rentals.
 *
 * RATES ARE EMPTY, like every other partner roster: Vic proposes list rates
 * from his own account page and HQ accepts them (rate-proposal.ts). Nothing
 * here reaches sirreel.com until a unit is listed, has a photo, AND the
 * Partner Equipment Agreement is signed (SUB_LISTED_WHERE) — so seeding is
 * safe to do before the call, not after it.
 *
 * PLAIN DATA, no Prisma import: scripts/onboard-vsm-planet.ts seeds from it
 * and tests/sub-rentals/photo-shoot-roster.test.ts guards its shape.
 */

import type { PartnerCatalogSectionKey } from '@/lib/site/partnerSections'

export interface PhotoShootUnit {
  /** SubcontractedVehicle.name — the match key on re-run, so renaming a row
   *  here creates a SECOND unit beside the old one (see the forklift note in
   *  onboard-power-trip.ts). Rename in the DB, not here. */
  name: string
  /**
   * SubcontractedVehicle.vehicleType — free text; the roster page groups on
   * it, and the staff typeahead MATCHES on it.
   *
   * Every one of these starts "Photo shoot — " on purpose. `/api/catalog/
   * search` matches a partner unit on its name and its type only (specs and
   * blurb are deliberately out, so a blurb that mentions a generator cannot
   * answer "generator"), and partner units have no alias table to fall back
   * on. Without the prefix a rep typing the name of the section — "photo",
   * "photo shoot" — got nothing back, which is the first thing anyone types.
   * Tokens are AND-ed and substring-matched, so the prefix answers "photo",
   * "shoot" and "photo shoot", and the half after the dash keeps "strobe",
   * "backdrop", "grip" and "camera" working as before.
   */
  vehicleType: string
  section: PartnerCatalogSectionKey
  /** One spec per line on the unit page. Never money, never a vendor name. */
  specs: string[]
  /** Client-facing blurb. `description` is the staff note and never shown. */
  publicDescription: string
}

/** Every unit collects the same way, so the sentence is written once. */
const COLLECTED = 'Picked up at our Hollywood counter, or delivered by arrangement'
const CONFIRM = 'Exact model and pack size confirmed at booking'

export const VSM_PLANET_NAME = 'VSM Planet Rentals'

/**
 * The partner facts the onboarding script asserts. Email and phone are
 * deliberately ABSENT: VSM Planet is already a partner row in the live DB
 * with a deal on it (35% / max 43%), so whatever contact is on file there is
 * better than anything this file could assert. The script only writes them
 * when passed on the command line.
 *
 * `lotAddress` is null for the same reason in the other direction — the site
 * says Hollywood and a directory listing says Glendale, and a wrong address
 * on a WILL_CALL partner sends a production to the wrong door. Vic sets it
 * from his account page; the portal's "You pick up" card reads it.
 */
export const VSM_PLANET = {
  name: VSM_PLANET_NAME,
  contactName: 'Vic Hartounian',
  website: 'https://www.vsmplanetrentals.com',
  partnerKind: 'EQUIPMENT' as const,
  catalogSection: 'PHOTO_SHOOT' as const,
  /**
   * WILL_CALL, not DELIVERY. A stills rental house is a counter business:
   * the production's van comes to the shop, the order is checked out across
   * the counter, and it comes back the same way. Getting this wrong is not
   * cosmetic — DELIVERY would ask Vic for a delivery window and a contact he
   * never agreed to, and PICKUP would ask him for a driver he does not have.
   * Switchable per booking on the job page, and per partner on
   * /crm/portals#partners, if Vic says otherwise on the call.
   */
  defaultReceiveMethod: 'WILL_CALL' as const,
  supplies:
    'photo shoot rentals — Profoto strobe packs, heads and monolights, light modifiers, continuous LED, seamless and painted backdrops, backdrop support, stands and stills grip, tethering carts and camera kits',
  deliveryTerms:
    'Will-call: the production collects from and returns to VSM Planet’s Hollywood counter. Delivery is available by arrangement and quoted per booking. Rental weeks and deposits per their rental terms — confirm with Vic.',
  notes:
    'Photo shoot rentals partner. Hollywood studio/production rental house, 23+ years, ~500 rental types from cameras and backings to Sprinter van packages; specialises in the Profoto line. Deal on file 35% to SirReel, will flex to 43% to keep a client (partnerMaxSharePercent). Their Sprinter van packages are deliberately NOT on the roster — that is our own fleet’s lane.',
} as const

/**
 * The two units to FEATURE first (Wes 2026-09-16: "let's find a couple of
 * items from VSM Planet to feature on our website and let's make them
 * live") — `FEATURED_FIRST` below, matched by name.
 *
 * One light and one background: the two things every stills shoot needs,
 * and between them they show the section has RANGE rather than two
 * variations on the same object.
 *
 *   · Profoto Pack & Head Kit — 2400 W/s. The house specialism is Profoto,
 *     this is the most-ordered thing in a stills package, and the name does
 *     the selling on its own.
 *   · Seamless Paper Backdrop — 107 in roll. The other half of the shoot,
 *     completely different in kind, and the one unit that photographs
 *     obviously — a catalog card of a paper sweep reads instantly.
 *
 * NOT the medium-format camera kit, though it is the highest-ticket row:
 * its detail is the loosest in this file (body and back unconfirmed), and
 * featuring the row most likely to need correcting after Vic's call is the
 * wrong first impression. NOT the C-stand package either — true and useful,
 * but it reads as commodity and does not say "photo" to someone scanning.
 */
export const FEATURED_FIRST: readonly string[] = [
  'Profoto Pack & Head Kit — 2400 W/s',
  'Seamless Paper Backdrop — 107 in roll',
] as const

export const VSM_PLANET_ROSTER: readonly PhotoShootUnit[] = [
  {
    name: 'Profoto Pack & Head Kit — 2400 W/s',
    vehicleType: 'Photo shoot — strobe lighting',
    section: 'PHOTO_SHOOT',
    specs: ['2400 W/s generator with two heads', 'Fast recycling and flash duration for movement', 'Standard reflectors and sync included', CONFIRM, COLLECTED],
    publicDescription:
      'The everyday studio strobe package: a 2400 watt-second pack with two heads, enough light for a seamless, a product table or a portrait set.',
  },
  {
    name: 'Profoto Pack & Head Kit — 4800 W/s',
    vehicleType: 'Photo shoot — strobe lighting',
    section: 'PHOTO_SHOOT',
    specs: ['4800 W/s across two generators', 'Up to four heads', 'For deep stop, large groups or big modifiers', CONFIRM, COLLECTED],
    publicDescription:
      'Twice the power for a wide set, a deep depth of field or a big modifier — pack, heads and reflectors, ready to plug in.',
  },
  {
    name: 'Profoto Monolight Kit — 2 heads',
    vehicleType: 'Photo shoot — strobe lighting',
    section: 'PHOTO_SHOOT',
    specs: ['Two self-contained monolights', 'No generator to carry — each head plugs into wall power', 'Stands and sync included', CONFIRM, COLLECTED],
    publicDescription:
      'Two self-contained strobe heads for a small studio day or an interview set — light without a pack to trip over.',
  },
  {
    name: 'Profoto Battery Strobe Kit — location',
    vehicleType: 'Photo shoot — strobe lighting',
    section: 'PHOTO_SHOOT',
    specs: ['Battery-powered heads — no wall power, no generator', 'High-speed sync for daylight fill', 'Case, spare batteries and charger', CONFIRM, COLLECTED],
    publicDescription:
      'Battery strobes for shooting away from power — a rooftop, a beach, a moving location. Daylight-balanced and fast enough to cut the sun.',
  },
  {
    name: 'Continuous LED Kit — daylight',
    vehicleType: 'Photo shoot — continuous lighting',
    section: 'PHOTO_SHOOT',
    specs: ['Daylight-balanced LED panels', 'Dimmable, flicker-free — stills and video off the same setup', 'Stands and diffusion included', CONFIRM, COLLECTED],
    publicDescription:
      'Continuous daylight LEDs for a shoot that shoots motion as well as stills — what you see is what you get, with no strobe to sync.',
  },
  {
    name: 'Light Modifier Package — softboxes, umbrellas & grids',
    vehicleType: 'Photo shoot — light modifiers',
    section: 'PHOTO_SHOOT',
    specs: ['Softboxes, strip banks and octaboxes', 'Shoot-through and silver umbrellas', 'Grids, gels and barn doors', 'Speedrings matched to the heads on the order', COLLECTED],
    publicDescription:
      'The shaping package that goes with the heads — soft boxes, strip banks, umbrellas, grids and gels, matched to whatever lights are on your order.',
  },
  {
    name: 'Beauty Dish & Reflector Package',
    vehicleType: 'Photo shoot — light modifiers',
    section: 'PHOTO_SHOOT',
    specs: ['Beauty dish with sock and grid', 'Hard reflectors and magnum', 'Collapsible reflectors and flags on stands', CONFIRM, COLLECTED],
    publicDescription:
      'Beauty dish, hard reflectors and fill boards for portrait and beauty work — the specular end of the light kit.',
  },
  {
    name: 'Seamless Paper Backdrop — 107 in roll',
    vehicleType: 'Photo shoot — backdrops & backings',
    section: 'PHOTO_SHOOT',
    specs: ['107 in (9 ft) wide roll', 'Colour chosen at booking', 'Consumable — billed by what is used', COLLECTED],
    publicDescription:
      'The standard nine-foot seamless roll, in the colour you pick, wide enough for a full-length portrait or a product sweep.',
  },
  {
    name: 'Seamless Paper Backdrop — 142 in roll',
    vehicleType: 'Photo shoot — backdrops & backings',
    section: 'PHOTO_SHOOT',
    specs: ['142 in (nearly 12 ft) wide roll', 'Colour chosen at booking', 'Needs the wide crossbar — add the support system', 'Consumable — billed by what is used'],
    publicDescription:
      'The wide seamless roll for groups, cars and anything that will not fit on a nine-foot sweep.',
  },
  {
    name: 'Hand-Painted Canvas Backdrop',
    vehicleType: 'Photo shoot — backdrops & backings',
    section: 'PHOTO_SHOOT',
    specs: ['Hand-painted canvas or muslin', 'Mottled, textured and solid finishes', 'Pattern and size chosen at booking', COLLECTED],
    publicDescription:
      'A painted canvas backing for portrait and editorial work — texture and depth a paper sweep cannot give you.',
  },
  {
    name: 'Backdrop Support System — stands, crossbar & autopoles',
    vehicleType: 'Photo shoot — backdrops & backings',
    section: 'PHOTO_SHOOT',
    specs: ['Backdrop stands with adjustable crossbar', 'Autopoles and wall mounts for a fixed studio', 'Chain drives for multiple rolls', 'Expan clamps and gaffer', COLLECTED],
    publicDescription:
      'Everything that holds the backing up — stands, crossbars, autopoles and wall mounts, so the sweep goes where you need it.',
  },
  {
    name: 'C-Stand & Grip Package — stills',
    vehicleType: 'Photo shoot — stands & grip',
    section: 'PHOTO_SHOOT',
    specs: ['C-stands with arms and knuckles', 'Flags, scrims and floppies', 'Apple boxes and sandbags', 'Clamps, A-clamps and gaffer', COLLECTED],
    publicDescription:
      'The stills grip package: C-stands, arms, flags, scrims, apple boxes and sandbags — the things that hold everything else in place.',
  },
  {
    name: 'Tethering & Digital Capture Cart',
    vehicleType: 'Photo shoot — digital capture',
    section: 'PHOTO_SHOOT',
    specs: ['Rolling cart with monitor arm and power', 'Tether cables, clamps and a tether boom', 'Capture workstation available — specify at booking', CONFIRM, COLLECTED],
    publicDescription:
      'A rolling tether cart for the digital tech — monitor, power, cables and somewhere to put the laptop that is not the floor.',
  },
  {
    name: 'Medium-Format Camera Kit — body, back & lenses',
    vehicleType: 'Photo shoot — cameras',
    section: 'PHOTO_SHOOT',
    specs: ['Medium-format body and digital back', 'Prime lens set', 'Cards, readers, batteries and charger', CONFIRM, COLLECTED],
    publicDescription:
      'A medium-format body, digital back and prime lenses for campaign, beauty and product work that has to hold up at size.',
  },
] as const

/** Roster units grouped by the `vehicleType` they were seeded under — what
 *  the roster page and the onboarding run print. */
export function rosterByType(roster: readonly PhotoShootUnit[] = VSM_PLANET_ROSTER): Map<string, PhotoShootUnit[]> {
  const out = new Map<string, PhotoShootUnit[]>()
  for (const u of roster) {
    const list = out.get(u.vehicleType) ?? []
    list.push(u)
    out.set(u.vehicleType, list)
  }
  return out
}
