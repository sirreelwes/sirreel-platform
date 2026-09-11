/**
 * Onboard PowerTrip Rentals as SirReel's second partner — the first
 * EQUIPMENT partner (generators, distro, HVAC, lifts, temporary lighting).
 *
 *   Evan Crawford, CEO. https://powertriprentals.com. Family business since
 *   2006 (Evan + his father Jay Crawford, who built the studio generator);
 *   yard in Signal Hill / Long Beach; serves film, TV, live and sporting
 *   events across Southern California and Las Vegas.
 *
 * What this does, idempotently (safe to re-run):
 *   1. Upserts the Vendor row by name — kind EQUIPMENT, default catalog
 *      section Power & Generators, website, yard address, what they supply.
 *      Contact email/phone are NOT known to the repo: pass --email / --phone
 *      (or set them on /admin/vendors) before sending the welcome.
 *   2. Seeds a starter roster of SubcontractedVehicle rows across their
 *      public categories, one per (vendor, name). Rates are left EMPTY on
 *      purpose: Evan proposes them from his partner page, HQ accepts. Every
 *      seeded unit is DELIVERY (they deliver and collect), unlisted, and
 *      carries a staff-only description flagging it as a placeholder to
 *      confirm with Evan. Nothing here reaches sirreel.com until a unit is
 *      listed, has a photo, AND the agreement is signed (SUB_LISTED_WHERE).
 *   3. Mints the partner's account link (Vendor.portalToken) and prints it.
 *      Minting is silent — the welcome email goes from the Portals tab
 *      (/crm/portals#vendor → PowerTrip → "Email the account link"), where
 *      the deal (% to SirReel) and the standard Partner EQUIPMENT Agreement
 *      are filed first.
 *
 * Writes a journal of every id it created (journals/onboard-power-trip-*.json)
 * so cleanup, if ever wanted, is by captured id.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   # Columns partner_kind / catalog_section / default_receive_method must
 *   # already exist. They do since 2026-09-09. For any future column use
 *   # additive SQL, NOT `prisma db push` — the live DB carries tables and
 *   # columns no schema file knows, and a push drops them (see 029d94e).
 *   npx tsx scripts/onboard-power-trip.ts [--email evan@…] [--phone 562-…] [--dry]
 */

import { writeFileSync, mkdirSync } from 'fs'
import { prisma } from '../src/lib/prisma'
import { ensureVendorPortalToken, vendorAccountUrl } from '../src/lib/sub-rentals/vendorAccount'

const VENDOR_NAME = 'PowerTrip Rentals'

const args = process.argv.slice(2)
const flag = (k: string): string | null => {
  const i = args.indexOf(k)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}
const DRY = args.includes('--dry')
const EMAIL = flag('--email')
const PHONE = flag('--phone')

const PLACEHOLDER_NOTE =
  'Seeded by scripts/onboard-power-trip.ts (2026-09-10) from PowerTrip’s public categories. Confirm the exact model, size and rates with Evan before quoting; rates are proposed by PowerTrip from their partner page.'

type Section = 'POWER_GENERATORS' | 'CABLES_DISTRO' | 'HVAC' | 'LIFTS' | 'LIGHTING' | 'CARTS'

const ROSTER: { name: string; vehicleType: string; section: Section; specs: string[]; publicDescription: string }[] = [
  {
    name: 'Studio Generator — 60 kW (silent, towable)',
    vehicleType: 'Towable studio generator',
    section: 'POWER_GENERATORS',
    specs: ['Sound-attenuated for dialogue', 'Towable — delivered and positioned by PowerTrip', 'Camlock output; distro available', 'Fueled on delivery'],
    publicDescription: 'A quiet, studio-built towable generator sized for a commercial or small-unit day. Delivered, cabled and started at your location.',
  },
  {
    name: 'Studio Generator — 100 kW (silent, towable)',
    vehicleType: 'Towable studio generator',
    section: 'POWER_GENERATORS',
    specs: ['Sound-attenuated for dialogue', 'Towable — delivered and positioned by PowerTrip', 'Camlock output; distro available', 'Fueled on delivery'],
    publicDescription: 'The workhorse studio generator for a full lighting package or base camp. Delivered, cabled and started at your location.',
  },
  {
    name: 'Studio Generator — 150 kW (silent, towable)',
    vehicleType: 'Towable studio generator',
    section: 'POWER_GENERATORS',
    specs: ['Sound-attenuated for dialogue', 'Towable — delivered and positioned by PowerTrip', 'Camlock output; distro available', 'Fueled on delivery'],
    publicDescription: 'A large quiet generator for a big lighting day, a stage or a base camp with HVAC on it. Delivered, cabled and started at your location.',
  },
  {
    name: 'Portable Generator — 7 kW (inverter)',
    vehicleType: 'Portable generator',
    section: 'POWER_GENERATORS',
    specs: ['Inverter — clean power for camera and playback', 'Quiet; wheeled', 'Delivered fueled'],
    publicDescription: 'A small quiet inverter generator for a splinter unit, video village or a single work light.',
  },
  {
    name: 'Distro Package — 400 A',
    vehicleType: 'Cable & distro',
    section: 'CABLES_DISTRO',
    specs: ['Feeder cable, banded and Bates', 'Distro boxes and lunch boxes', 'Sized with the generator it feeds'],
    publicDescription: 'Cable and distribution to get generator power from the truck to the set, sized to your load.',
  },
  {
    name: 'Portable Air Conditioner — 5 ton',
    vehicleType: 'HVAC',
    section: 'HVAC',
    specs: ['Portable, ducted', 'Delivered and set up', 'Runs on generator or house power'],
    publicDescription: 'Spot cooling for a stage, tent or location interior, delivered and set up.',
  },
  {
    name: 'Heater — indirect-fired',
    vehicleType: 'HVAC',
    section: 'HVAC',
    specs: ['Indirect-fired — clean, dry heat', 'Ducted', 'Delivered and set up'],
    publicDescription: 'Clean, ducted heat for a tent, stage or night exterior holding area.',
  },
  {
    name: 'Scissor Lift — 19 ft',
    vehicleType: 'Scissor lift',
    section: 'LIFTS',
    specs: ['19 ft platform height', 'Electric — indoor safe', 'Delivered to the location'],
    publicDescription: 'An electric scissor lift for rigging and set construction, delivered to your stage or location.',
  },
  {
    name: 'Boom Lift — 45 ft',
    vehicleType: 'Boom lift',
    section: 'LIFTS',
    specs: ['45 ft working height', 'Articulating', 'Delivered to the location'],
    publicDescription: 'An articulating boom lift for high rigging and exterior work, delivered to your location.',
  },
  {
    // Renamed 2026-09-10 (Wes). It was seeded as a telehandler; PowerTrip's
    // catalog lists no telehandler at this capacity — the 8,000 lb machine
    // they actually own is a warehouse forklift, which is what their photo
    // shows. Their reach forklifts start at 9,000 lb. This list is matched by
    // NAME on re-run, so the old name here would create a second unit beside
    // the renamed one.
    name: 'Warehouse Forklift — 8,000 lb',
    vehicleType: 'Warehouse forklift',
    section: 'LIFTS',
    specs: ['8,000 lb capacity', 'Warehouse forklift', 'Delivered to the location'],
    publicDescription: 'An 8,000 lb warehouse forklift for set construction and unloading, delivered to your location.',
  },
  {
    name: 'Light Tower — 4 × 1,000 W',
    vehicleType: 'Temporary lighting',
    section: 'LIGHTING',
    specs: ['Four 1,000 W heads on a telescoping mast', 'Self-powered, towable', 'Delivered and positioned'],
    publicDescription: 'A self-powered light tower for base camp, parking and night work areas.',
  },
  {
    name: 'Golf Cart — 4 seat',
    vehicleType: 'Golf cart',
    section: 'CARTS',
    specs: ['Four-seat', 'Electric', 'Delivered to the location'],
    publicDescription: 'A four-seat electric cart for moving crew around a large location.',
  },
  {
    name: 'Flat-Bed Cart',
    vehicleType: 'Utility cart',
    section: 'CARTS',
    specs: ['Flat-bed utility cart', 'Electric', 'Delivered to the location'],
    publicDescription: 'A flat-bed utility cart for moving gear around a large location.',
  },
]

async function main() {
  console.log(`${DRY ? '[dry run] ' : ''}Onboarding ${VENDOR_NAME}…`)
  const journal: { vendorId: string | null; createdUnitIds: string[]; existingUnitIds: string[]; portalUrl: string | null; at: string } = {
    vendorId: null, createdUnitIds: [], existingUnitIds: [], portalUrl: null, at: new Date().toISOString(),
  }

  const base = {
    contactName: 'Evan Crawford',
    website: 'https://powertriprentals.com',
    supplies: 'generators, cable & distro, HVAC, lifts & material handling, temporary lighting, carts',
    // Yelp lists the Signal Hill yard (2026); older listings give
    // 2417 E Rancho Del Amo Pl, Los Angeles 90220. Evan corrects it from his page.
    lotAddress: '2501 Orange Ave, Signal Hill, CA 90755',
    deliveryTerms: '24/7/365 service line. Units are delivered, set up and collected by PowerTrip crews; delivery, fuel and technician time are charged on top of the unit rate.',
    partnerKind: 'EQUIPMENT' as const,
    catalogSection: 'POWER_GENERATORS' as const,
    ...(EMAIL ? { email: EMAIL } : {}),
    ...(PHONE ? { phone: PHONE } : {}),
  }

  const existing = await prisma.vendor.findUnique({ where: { name: VENDOR_NAME }, select: { id: true, email: true, phone: true, partnerKind: true } })
  if (DRY) {
    console.log(existing ? `vendor exists (${existing.id}) — would update kind/section/details` : 'would create vendor', base)
  }
  const vendor = DRY
    ? existing
    : await prisma.vendor.upsert({
        where: { name: VENDOR_NAME },
        // Never clobber a contact HQ or Evan has since set: email/phone only
        // land when passed explicitly; everything else is ours to assert.
        update: base,
        create: { name: VENDOR_NAME, ...base, notes: 'Partner since 2026-09. Owner Evan Crawford; founded 2006 with Jay Crawford (Crawford Studio Generators).' },
        select: { id: true, email: true, phone: true, partnerKind: true },
      })
  if (!vendor) { console.log('nothing to do in dry run without an existing vendor'); return }
  journal.vendorId = vendor.id
  console.log(`✓ vendor ${VENDOR_NAME} (${vendor.id}) · ${vendor.partnerKind}${vendor.email ? ` · ${vendor.email}` : ' · NO EMAIL YET — pass --email before inviting'}`)

  for (const u of ROSTER) {
    const found = await prisma.subcontractedVehicle.findFirst({ where: { vendorId: vendor.id, name: u.name }, select: { id: true } })
    if (found) { journal.existingUnitIds.push(found.id); console.log(`  = ${u.name} (exists)`); continue }
    if (DRY) { console.log(`  + would create ${u.name} [${u.section}]`); continue }
    const created = await prisma.subcontractedVehicle.create({
      data: {
        vendorId: vendor.id,
        name: u.name,
        vehicleType: u.vehicleType,
        description: PLACEHOLDER_NOTE,
        publicDescription: u.publicDescription,
        specs: u.specs.join('\n'),
        catalogSection: u.section,
        defaultReceiveMethod: 'DELIVERY',
        publiclyListed: false,
        offeredToSirReel: true,
      },
      select: { id: true },
    })
    journal.createdUnitIds.push(created.id)
    console.log(`  + ${u.name} (${created.id}) [${u.section}]`)
  }

  if (!DRY) {
    const token = await ensureVendorPortalToken(vendor.id)
    journal.portalUrl = vendorAccountUrl(token)
    console.log(`\nPartner account link (minted, NOT sent): ${journal.portalUrl}`)
    console.log('Next, on /crm/portals#vendor → PowerTrip Rentals: set the deal (% to SirReel), file the standard Partner Equipment Agreement, then "Email the account link" to Evan.')
    mkdirSync('journals', { recursive: true })
    const file = `journals/onboard-power-trip-${journal.at.replace(/[:.]/g, '-')}.json`
    writeFileSync(file, JSON.stringify(journal, null, 2))
    console.log(`journal: ${file}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
