/**
 * Put VSM Planet Rentals' gear into the Photo Shoot Rentals section.
 *
 *   Vic Hartounian. https://www.vsmplanetrentals.com. Hollywood studio and
 *   production rental house, 23+ years, ~500 rental types from cameras and
 *   backings to Sprinter van packages; specialises in the Profoto line.
 *   Already a partner row in the live DB with a deal on it (35% to SirReel,
 *   will flex to 43% to keep a client).
 *
 * Wes 2026-09-11 made Photo Shoot Rentals a class — a quote department, a
 * public catalog section, a 3-day rental week for gear SirReel carries
 * there. Nothing was ever put IN it, so `#photo-shoot` has been a heading
 * over an empty page. This seeds the gear (Wes 2026-09-16: "build the photo
 * section for SirReel using VSM gear").
 *
 * What it does, idempotently (safe to re-run):
 *   1. PREFLIGHT — refuses (exit 2) unless PHOTO_SHOOT exists on the
 *      PartnerCatalogSection enum. A Prisma client 500s on an enum value the
 *      DB does not know, so writing the rows before
 *      scripts/add-photo-shoot-enum-values.ts has run would take the partner
 *      page down rather than fail here. It ran 2026-09-11; the check is for
 *      a restored or a fresh database.
 *   2. Upserts the Vendor by name — kind EQUIPMENT, default catalog section
 *      Photo Shoot Rentals, default receive method WILL_CALL (a stills
 *      rental house is a counter business: the production collects). These
 *      three are ASSERTED on re-run, because they are the point of the
 *      script. Everything else is FILL-IF-EMPTY: VSM already exists with a
 *      deal and a contact, and the live row beats anything this file knows.
 *      Contact email/phone land only when passed as --email / --phone.
 *   3. Seeds the starter roster (src/lib/sub-rentals/photoShootRoster.ts),
 *      matched on (vendor, name) so a second run adds nothing. Rates are
 *      left EMPTY on purpose: Vic proposes them from his partner page and HQ
 *      accepts. Every unit is unlisted and carries a staff-only note to
 *      confirm the model and rate with Vic before quoting. Nothing reaches
 *      sirreel.com until a unit is listed, has a photo, AND the Partner
 *      Equipment Agreement is signed (SUB_LISTED_WHERE).
 *   4. Mints the account link (silent — the email is a button on the Portals
 *      tab) and prints it.
 *
 * Writes a journal of every id it created (journals/onboard-vsm-planet-*.json)
 * so cleanup, if ever wanted, is by captured id — never by pattern.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/onboard-vsm-planet.ts --dry
 *   npx tsx scripts/onboard-vsm-planet.ts [--email vic@… --phone 323-… --receive DELIVERY]
 *
 * No schema change: every column written here has existed since 2026-09-15.
 * For any future column use additive SQL, NOT `prisma db push` — the live DB
 * carries tables and columns no schema file knows, and a push drops them.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { prisma } from '../src/lib/prisma'
import { ensureVendorPortalToken, vendorAccountUrl } from '../src/lib/sub-rentals/vendorAccount'
import { VSM_PLANET, VSM_PLANET_NAME, VSM_PLANET_ROSTER, rosterByType } from '../src/lib/sub-rentals/photoShootRoster'

const args = process.argv.slice(2)
const flag = (k: string): string | null => {
  const i = args.indexOf(k)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}
const DRY = args.includes('--dry')
const EMAIL = flag('--email')
const PHONE = flag('--phone')
const RECEIVE = flag('--receive')

const RECEIVE_METHODS = ['PICKUP', 'DELIVERY', 'WILL_CALL'] as const
type ReceiveMethod = (typeof RECEIVE_METHODS)[number]
if (RECEIVE && !RECEIVE_METHODS.includes(RECEIVE as ReceiveMethod)) {
  console.error(`--receive must be one of ${RECEIVE_METHODS.join(' / ')}`)
  process.exit(1)
}
const receiveMethod: ReceiveMethod = (RECEIVE as ReceiveMethod) ?? VSM_PLANET.defaultReceiveMethod

const PLACEHOLDER_NOTE =
  'Seeded by scripts/onboard-vsm-planet.ts (2026-09-16) from VSM Planet’s public shape — a Profoto house with cameras, backings and stills grip. Confirm the exact model, pack size and rates with Vic before quoting; rates are proposed by VSM Planet from their partner page.'

/** The enum value must be in the DB before a row can point at it. */
async function preflight(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'PartnerCatalogSection'`,
  )
  const labels = rows.map((r) => r.enumlabel)
  if (!labels.includes('PHOTO_SHOOT')) {
    console.error(
      `PartnerCatalogSection has no PHOTO_SHOOT value (has: ${labels.join(', ')}).\n` +
        'Run scripts/add-photo-shoot-enum-values.ts first, then deploy the code that knows it, then re-run this.',
    )
    process.exit(2)
  }
  console.log('✓ preflight: PartnerCatalogSection.PHOTO_SHOOT exists')
}

async function main() {
  console.log(`${DRY ? '[dry run] ' : ''}Building the Photo Shoot Rentals section from ${VSM_PLANET_NAME}…`)
  await preflight()

  const journal: {
    vendorId: string | null
    createdUnitIds: string[]
    existingUnitIds: string[]
    portalUrl: string | null
    at: string
  } = { vendorId: null, createdUnitIds: [], existingUnitIds: [], portalUrl: null, at: new Date().toISOString() }

  const existing = await prisma.vendor.findUnique({
    where: { name: VSM_PLANET_NAME },
    select: {
      id: true, email: true, phone: true, partnerKind: true, catalogSection: true,
      defaultReceiveMethod: true, contactName: true, website: true, supplies: true,
      deliveryTerms: true, notes: true, lotAddress: true,
    },
  })

  // ASSERTED every run — this is what files them under Photo Shoot Rentals
  // and stops the booking flow asking Vic for a driver he does not have.
  const asserted = {
    partnerKind: VSM_PLANET.partnerKind,
    catalogSection: VSM_PLANET.catalogSection,
    defaultReceiveMethod: receiveMethod,
  }
  // FILL-IF-EMPTY — never clobber what HQ or Vic has since typed.
  const fill: Record<string, string> = {}
  const fillIfEmpty = (key: 'contactName' | 'website' | 'supplies' | 'deliveryTerms' | 'notes', value: string) => {
    if (!existing || !existing[key]) fill[key] = value
  }
  fillIfEmpty('contactName', VSM_PLANET.contactName)
  fillIfEmpty('website', VSM_PLANET.website)
  fillIfEmpty('supplies', VSM_PLANET.supplies)
  fillIfEmpty('deliveryTerms', VSM_PLANET.deliveryTerms)
  fillIfEmpty('notes', VSM_PLANET.notes)
  if (EMAIL) fill.email = EMAIL
  if (PHONE) fill.phone = PHONE

  if (DRY) {
    console.log(existing ? `vendor exists (${existing.id})` : 'vendor does not exist — would create it')
    console.log('  would assert:', asserted)
    console.log('  would fill  :', Object.keys(fill).length ? fill : '(nothing — everything already set)')
  }

  const vendor = DRY
    ? existing
    : await prisma.vendor.upsert({
        where: { name: VSM_PLANET_NAME },
        update: { ...asserted, ...fill },
        create: {
          name: VSM_PLANET_NAME,
          ...asserted,
          contactName: VSM_PLANET.contactName,
          website: VSM_PLANET.website,
          supplies: VSM_PLANET.supplies,
          deliveryTerms: VSM_PLANET.deliveryTerms,
          notes: VSM_PLANET.notes,
          ...(EMAIL ? { email: EMAIL } : {}),
          ...(PHONE ? { phone: PHONE } : {}),
        },
        select: { id: true, email: true, phone: true, partnerKind: true, catalogSection: true, defaultReceiveMethod: true },
      })

  if (!vendor) {
    console.log('nothing further to do in a dry run without an existing vendor')
    return
  }
  journal.vendorId = vendor.id
  console.log(
    `✓ vendor ${VSM_PLANET_NAME} (${vendor.id}) · ${vendor.partnerKind} · ${vendor.catalogSection} · receives ${vendor.defaultReceiveMethod}` +
      `${vendor.email ? ` · ${vendor.email}` : ' · NO EMAIL ON FILE — pass --email before inviting'}`,
  )

  for (const [type, units] of rosterByType(VSM_PLANET_ROSTER)) {
    console.log(`\n${type}`)
    for (const u of units) {
      const found = await prisma.subcontractedVehicle.findFirst({
        where: { vendorId: vendor.id, name: u.name },
        select: { id: true },
      })
      if (found) {
        journal.existingUnitIds.push(found.id)
        console.log(`  = ${u.name} (exists)`)
        continue
      }
      if (DRY) {
        console.log(`  + would create ${u.name} [${u.section}]`)
        continue
      }
      const created = await prisma.subcontractedVehicle.create({
        data: {
          vendorId: vendor.id,
          name: u.name,
          vehicleType: u.vehicleType,
          description: PLACEHOLDER_NOTE,
          publicDescription: u.publicDescription,
          specs: u.specs.join('\n'),
          catalogSection: u.section,
          // NULL on purpose: the unit falls through to the vendor's default,
          // so changing how VSM hands gear over is one edit on the Portals
          // row rather than fourteen.
          defaultReceiveMethod: null,
          publiclyListed: false,
          offeredToSirReel: true,
        },
        select: { id: true },
      })
      journal.createdUnitIds.push(created.id)
      console.log(`  + ${u.name} (${created.id})`)
    }
  }

  if (DRY) {
    console.log(`\n[dry run] nothing written. ${VSM_PLANET_ROSTER.length} units in the roster.`)
    return
  }

  const token = await ensureVendorPortalToken(vendor.id)
  journal.portalUrl = vendorAccountUrl(token)
  console.log(`\nPartner account link (minted, NOT sent): ${journal.portalUrl}`)
  console.log(
    'Next, on /crm/portals#partners → VSM Planet Rentals:\n' +
      '  1. check the deal (35% to SirReel, max 43%) and the main contact,\n' +
      '  2. file the standard Partner EQUIPMENT Agreement — v2026-09-11 or later, the one that carries the shared-discount clause,\n' +
      '  3. "Email the account link" to Vic, so he can price the roster, correct the models and put photos up,\n' +
      '  4. list the units once they have a photo and a rate — that is what makes #photo-shoot appear on sirreel.com.',
  )

  mkdirSync('journals', { recursive: true })
  const file = `journals/onboard-vsm-planet-${journal.at.replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify(journal, null, 2))
  console.log(`journal: ${file}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
