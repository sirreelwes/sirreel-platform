/**
 * Partner PROSPECTS — companies SirReel would like as partners, researched
 * before any contact, with the starter roster each would get once marked.
 *
 * Wes 2026-09-11: "no company gets onboarded until they reply and I mark it
 * as a new partner." So this registry seeds NOTHING but a Vendor row (the
 * prospect — enough to send the introduction from /crm/portals#partners). The
 * roster below is created only by markAsPartner() in partnerStage.ts, when
 * Wes presses "Mark as new partner" after they reply.
 *
 * First cohort (2026-09-10): Los Angeles battery-power outfits that rent to
 * productions ("find me a Los Angeles based battery powered generator
 * [company that] rents to productions in Los Angeles"). Ranked; the first is
 * the one to lead with.
 *
 * Every candidate is an EQUIPMENT partner in the PowerTrip mould: units are
 * delivered, set up and collected (no driver), rates are EMPTY on purpose —
 * the partner proposes them from their account page and HQ accepts — and
 * every seeded unit is unlisted until it has a photo, a rate and a signed
 * Partner Equipment Agreement.
 *
 * Contact details are what the public web says (the research session could
 * not open the companies' own sites — the network egress proxy blocks them —
 * so addresses and phones come from directory listings, the ICG Local 600
 * article and the search index). Confirm on the first call. Emails are
 * seeded only where printed in full somewhere quotable: a guessed address
 * sends the introduction to nobody.
 *
 * PLAIN DATA, no Prisma import: scripts/onboard-battery-partners.ts reads it
 * to queue prospects, markAsPartner() reads it to seed the roster, and
 * tests/sub-rentals/battery-partner-candidates.test.ts guards its shape.
 */

export type BatteryPartnerSection = 'POWER_GENERATORS' | 'CABLES_DISTRO' | 'LIGHTING' | 'CARTS'

export interface BatteryPartnerUnit {
  name: string
  vehicleType: string
  section: BatteryPartnerSection
  specs: string[]
  publicDescription: string
}

export interface PartnerProspect {
  /** CLI key: `--only saniset`. */
  slug: string
  /** Vendor.name — the upsert key; must be unique across candidates. */
  name: string
  contactName: string | null
  website: string
  /** Known and quotable, or null. Never guess an email. */
  email: string | null
  phone: string | null
  lotAddress: string | null
  supplies: string
  deliveryTerms: string
  notes: string
  /** Why this one, and what to watch — printed by the runner, shown to Wes. */
  fit: string
  caveat: string | null
  roster: BatteryPartnerUnit[]
}

/** @deprecated name kept for the first cohort's callers; the type is PartnerProspect. */
export type BatteryPartnerCandidate = PartnerProspect

const DELIVERED = 'Delivered, set up and collected by the partner'
const FUEL_FREE = 'No fuel, no exhaust, no engine noise — runs next to talent and sound'

export const PARTNER_PROSPECTS: readonly PartnerProspect[] = [
  {
    slug: 'saniset',
    name: 'Saniset Fleet',
    contactName: 'Steve Yandrich',
    website: 'https://www.sanisetfleet.com',
    email: null,
    phone: '(818) 330-4052',
    lotAddress: '7700 Balboa Blvd, Van Nuys, CA 91406',
    supplies: 'battery energy storage (CleanGEN J250 and portable battery systems), electric passenger and cargo vans, clean mobile power for film/TV, live events and bridge power',
    deliveryTerms: 'Units are delivered, connected and collected by Saniset crews; delivery and technician time are charged on top of the unit rate. Recharge / swap scheduling agreed per booking.',
    notes: 'Candidate battery-power partner (researched 2026-09-10). Van Nuys, moved to the Balboa Blvd facility March 2026 and toured by ICG Local 600 members 2026-05-21. Co-founder Steve Yandrich. Sunset Studios Cleantech Demo Days participant. Also partners with Creative Mandate on stage rental at the same address.',
    fit: 'LA-based (Van Nuys), battery-FIRST — the whole company is clean mobile power for productions — and already known to the camera guild. The CleanGEN J250 is a real diesel-generator replacement (250 kWh, ~800 A at 208 V), not a camera-battery box.',
    caveat: 'Also rents electric passenger/cargo vans, which sits next to our own fleet; the roster here is power only. No public email found — get it on the call.',
    roster: [
      {
        name: 'CleanGEN J250 — 250 kWh battery generator',
        vehicleType: 'Battery energy storage system',
        section: 'POWER_GENERATORS',
        specs: ['250 kWh stored', '≈800 A at 208 V three-phase — replaces a towable diesel studio generator', 'Camlock output; distro available', FUEL_FREE, DELIVERED],
        publicDescription: 'A silent, zero-emission battery generator with the capacity of a studio diesel for a full lighting day or a base camp. Delivered, cabled and switched on at your location.',
      },
      {
        name: 'Portable Battery System — 10 kWh',
        vehicleType: 'Portable battery system',
        section: 'POWER_GENERATORS',
        specs: ['≈10 kWh stored', 'Wheeled — indoor safe', 'Edison and twist-lock outputs', FUEL_FREE, DELIVERED],
        publicDescription: 'A quiet, wheeled battery for video village, a splinter unit, a workstation or a single light — indoors or out, no fumes.',
      },
      {
        name: 'Distro Package — battery generator',
        vehicleType: 'Cable & distro',
        section: 'CABLES_DISTRO',
        specs: ['Feeder cable, banded and Bates', 'Distro boxes and lunch boxes', 'Sized with the battery unit it feeds'],
        publicDescription: 'Cable and distribution to carry battery power from the unit to set, sized to your load.',
      },
    ],
  },
  {
    slug: 'pigpen',
    name: 'Pig Pen Rentals',
    contactName: null,
    website: 'https://www.pigpenrentals.com',
    email: null,
    phone: '(310) 730-7447',
    lotAddress: null,
    supplies: 'mobile battery systems, portable power stations, solar generators, large battery energy storage systems, light towers; delivered across Los Angeles County',
    deliveryTerms: 'Delivered and set up; delivery and setup quoted per site. Weekly pricing published (film production power from $600/week, mobile battery from $325/week).',
    notes: 'Candidate battery-power partner (researched 2026-09-10). Los Angeles County; phone listed as (310) 730-PIGS. Their core business is portable toilet and fence rental — battery power is a service line with dedicated film/TV, event and mobile-battery pages. Owner, yard address and email not found publicly.',
    fit: 'LA-native, delivers county-wide, publishes weekly pricing and has a page written specifically for film / TV / commercial production power (basecamp, charging, noise-sensitive shoots).',
    caveat: 'Battery power is a side line of a sanitation-and-fence rental company, and no unit sizes are published — confirm what they actually run before quoting. No named contact.',
    roster: [
      {
        name: 'Mobile Battery System — mid-size',
        vehicleType: 'Battery energy storage system',
        section: 'POWER_GENERATORS',
        specs: ['Size to be confirmed with Pig Pen', 'Silent — basecamp and noise-sensitive shoots', FUEL_FREE, DELIVERED],
        publicDescription: 'A silent mobile battery for base camp, charging and lighting support, delivered and set up at your location.',
      },
      {
        name: 'Portable Power Station',
        vehicleType: 'Portable battery system',
        section: 'POWER_GENERATORS',
        specs: ['Size to be confirmed with Pig Pen', 'Wheeled — indoor safe', FUEL_FREE, DELIVERED],
        publicDescription: 'A quiet portable power station for video village, a splinter unit or a workstation.',
      },
      {
        name: 'Light Tower — battery / solar',
        vehicleType: 'Temporary lighting',
        section: 'LIGHTING',
        specs: ['Battery or solar powered light tower', 'Telescoping mast', 'No engine noise at base camp', DELIVERED],
        publicDescription: 'A silent, self-powered light tower for base camp, parking and night work areas.',
      },
    ],
  },
  {
    slug: 'greenlite',
    name: 'GreenLite Trailers',
    contactName: null,
    website: 'https://greenliteca.com',
    email: 'info@greenlitetrailers.com',
    phone: '(661) 613-2128',
    lotAddress: '34855 Peterson Road, Agua Dulce, CA 91350',
    supplies: 'Moxion 600/75 battery power supply (530 kWh / 40 kW), solar/electric production trailers, star trailers, production trailers and trucks',
    deliveryTerms: 'Delivered, positioned and collected by GreenLite; remote monitoring on the electric units. Delivery and technician time charged on top of the unit rate.',
    notes: 'Candidate battery-power partner (researched 2026-09-10). Agua Dulce (LA County, north of Santa Clarita). Affiliate of B.I. Production Works (Madison, GA; bipworks.com) alongside Emerald Green. First to offer solar-powered trailers built for the entertainment industry; Moxion 600/75 units with real-time monitoring.',
    fit: 'LA County, production-only, with the biggest battery in the group — a Moxion 600/75 (530 kWh, 40 kW continuous at 480 V three-phase) that replaces a base-camp diesel outright, plus solar/electric trailers.',
    caveat: 'They ALSO rent star trailers, production trailers and trucks — that is our Specialty Vehicles category, so they are part competitor. Roster here is power only; decide on the call whether their trailers are in or out. Georgia parent.',
    roster: [
      {
        name: 'Moxion 600/75 — 530 kWh battery power supply',
        vehicleType: 'Battery energy storage system',
        section: 'POWER_GENERATORS',
        specs: ['530 kWh stored', '40 kW continuous at 480 V three-phase', 'Small footprint — fits where a towable will not', 'Real-time remote monitoring', FUEL_FREE, DELIVERED],
        publicDescription: 'A silent, zero-emission base-camp power supply with more than a day of stored energy for trailers, HVAC and lighting. Delivered, positioned and monitored remotely.',
      },
      {
        name: 'Distro Package — Moxion 600/75',
        vehicleType: 'Cable & distro',
        section: 'CABLES_DISTRO',
        specs: ['480 V three-phase feeder', 'Transformer and distro to 208 V / 120 V', 'Sized with the battery unit it feeds'],
        publicDescription: 'Transformer, cable and distribution to bring battery power from the unit to trailers and set.',
      },
    ],
  },
  {
    slug: 'greenwave',
    name: 'Greenwave Rentals',
    contactName: null,
    website: 'https://www.greenwaverentals.com',
    email: null,
    phone: '+1 (236) 477-5336',
    lotAddress: null,
    supplies: 'Voltstack LiFePO4 battery power stations — 2K, 5K and trailer-mounted 20K — for film/TV, live events and critical operations',
    deliveryTerms: 'Delivered fully charged and collected; recharge or swap arranged per booking. Delivery and technician time charged on top of the unit rate.',
    notes: 'Candidate battery-power partner (researched 2026-09-10). Vancouver-based, serves Vancouver, Toronto and Los Angeles; a Greenwave Rentals LLC is filed in Sacramento. Fleet is Portable Electric Voltstack (2K: 2.4 kW / 2.8 kWh · 5K: 4.8 kW / 5.6 kWh · 20K trailer: up to 20.4 kW). Credits include The Mandalorian, No Time to Die, Percy Jackson, Fire Country. Los Angeles depot address not published.',
    fit: 'The deepest film résumé of the four (Mandalorian set builds ran on their batteries) and a clean, well-known product line in three sizes.',
    caveat: 'Not LA-based — Canadian HQ with an LA service area and a BC phone number. Ask where the LA units actually sit and who answers at 6 a.m. before treating them as local.',
    roster: [
      {
        name: 'Voltstack 20K — trailer battery generator',
        vehicleType: 'Battery energy storage system',
        section: 'POWER_GENERATORS',
        specs: ['Up to 20.4 kW continuous', 'Trailer-mounted, LiFePO4', 'Camlock and twist-lock output', FUEL_FREE, DELIVERED],
        publicDescription: 'A trailer-mounted silent battery generator for a commercial or small-unit lighting day, delivered charged and collected.',
      },
      {
        name: 'Voltstack 5K — 5.6 kWh portable',
        vehicleType: 'Portable battery system',
        section: 'POWER_GENERATORS',
        specs: ['4.8 kW continuous · 5.6 kWh stored', 'Wheeled — indoor safe', FUEL_FREE, DELIVERED],
        publicDescription: 'A wheeled silent battery for a splinter unit, video village or a workstation, indoors or out.',
      },
      {
        name: 'Voltstack 2K — 2.8 kWh portable',
        vehicleType: 'Portable battery system',
        section: 'POWER_GENERATORS',
        specs: ['2.4 kW continuous · 2.8 kWh stored', 'Carry-size — one person', FUEL_FREE, DELIVERED],
        publicDescription: 'A carry-size silent battery for camera, sound and a single light.',
      },
    ],
  },
]

/** The first cohort, by the name the script and the docs use. */
export const BATTERY_PARTNER_CANDIDATES = PARTNER_PROSPECTS

export function findPartnerProspect(slug: string): PartnerProspect | null {
  const s = slug.trim().toLowerCase()
  return PARTNER_PROSPECTS.find((c) => c.slug === s) ?? null
}

/** Match a Vendor row back to its prospect entry — by name, which is the
 *  upsert key the script used, so a marked vendor finds its starter roster. */
export function findPartnerProspectByName(name: string): PartnerProspect | null {
  const n = name.trim().toLowerCase()
  return PARTNER_PROSPECTS.find((c) => c.name.toLowerCase() === n) ?? null
}

/** @deprecated use findPartnerProspect */
export const findBatteryPartnerCandidate = findPartnerProspect
