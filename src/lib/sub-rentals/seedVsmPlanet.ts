/**
 * Seeding VSM Planet's photo roster — the WORK, separated from the way it
 * is started.
 *
 * Wes 2026-09-16: "I need to be able to run these scripts from my iPad with
 * no access to my actual laptop." `npx tsx scripts/…` cannot answer that,
 * and no amount of wrapping makes it: `scripts/` is not traced into the
 * Vercel lambda (next.config.js only includes the markdown AHA reads), tsx
 * is a devDependency, and spawning a process out of a serverless function
 * is not something to build a production seed on. So the logic lives here
 * and gets TWO entry points:
 *
 *   laptop  scripts/onboard-vsm-planet.ts   — thin wrapper, writes the journal file
 *   iPad    /admin/maintenance              — same function, writes an AuditLog row
 *
 * ONE implementation. A seed that behaves differently depending on which
 * button started it is worse than one that only runs in a terminal.
 *
 * Everything here is idempotent and returns what it did rather than
 * printing it: the caller decides whether that becomes stdout, a JSON
 * journal, or a screen on a phone. Nothing calls process.exit — a refusal
 * is a thrown `SeedRefused`, which the CLI turns into an exit code and the
 * route turns into a 409.
 */

import { prisma } from '@/lib/prisma'
import { ensureVendorPortalToken, vendorAccountUrl } from '@/lib/sub-rentals/vendorAccount'
import { VSM_PLANET, VSM_PLANET_NAME, VSM_PLANET_ROSTER } from '@/lib/sub-rentals/photoShootRoster'

export type ReceiveMethodKey = 'PICKUP' | 'DELIVERY' | 'WILL_CALL'
export const RECEIVE_METHODS: readonly ReceiveMethodKey[] = ['PICKUP', 'DELIVERY', 'WILL_CALL']

/** A refusal the operator can act on — never a stack trace on a phone. */
export class SeedRefused extends Error {
  constructor(message: string, readonly fix: string) {
    super(message)
    this.name = 'SeedRefused'
  }
}

export interface SeedVsmOptions {
  /** Report what would happen and write NOTHING. */
  dryRun: boolean
  /** Only written when passed — never clobbers what HQ or Vic has set. */
  email?: string | null
  phone?: string | null
  /** Overrides the roster's WILL_CALL default. */
  receiveMethod?: ReceiveMethodKey | null
}

export interface SeedVsmResult {
  dryRun: boolean
  vendorId: string | null
  vendorExisted: boolean
  /** Fields asserted on every run — what files them under Photo Shoot Rentals. */
  asserted: Record<string, string>
  /** Fields written only because they were empty. */
  filled: string[]
  /** Ids created THIS RUN. The only thing a cleanup may ever delete by. */
  createdUnitIds: string[]
  /** Units already present, matched by name. */
  existingUnitIds: string[]
  /** Dry run only: the units that would be created, by name. */
  wouldCreate: string[]
  accountUrl: string | null
  /** Human-readable trace, in order. */
  log: string[]
}

const PLACEHOLDER_NOTE =
  'Seeded by the VSM Planet photo-roster task (2026-09-16) from VSM Planet’s public shape — a Profoto house with cameras, backings and stills grip. Confirm the exact model, pack size and rates with Vic before quoting; rates are proposed by VSM Planet from their partner page.'

/**
 * The enum value must exist in the DB before a row can point at it — a
 * Prisma client 500s reading an enum label it does not know, so writing
 * these rows against an older database takes the partner page down rather
 * than failing here. Ran 2026-09-11; the check is for a restored or fresh
 * database, and it is the one thing this task will not do for you.
 */
async function preflight(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'PartnerCatalogSection'`,
  )
  const labels = rows.map((r) => r.enumlabel)
  if (!labels.includes('PHOTO_SHOOT')) {
    throw new SeedRefused(
      `PartnerCatalogSection has no PHOTO_SHOOT value (has: ${labels.join(', ')}).`,
      'This one needs a laptop: run scripts/add-photo-shoot-enum-values.ts, deploy, then run this again.',
    )
  }
  return '✓ preflight: PartnerCatalogSection.PHOTO_SHOOT exists'
}

export async function seedVsmPlanet(opts: SeedVsmOptions): Promise<SeedVsmResult> {
  const { dryRun } = opts
  const receiveMethod: ReceiveMethodKey = opts.receiveMethod ?? VSM_PLANET.defaultReceiveMethod
  if (!RECEIVE_METHODS.includes(receiveMethod)) {
    throw new SeedRefused(`Unknown receive method "${receiveMethod}".`, `Use one of ${RECEIVE_METHODS.join(' / ')}.`)
  }

  const log: string[] = []
  const result: SeedVsmResult = {
    dryRun, vendorId: null, vendorExisted: false, asserted: {}, filled: [],
    createdUnitIds: [], existingUnitIds: [], wouldCreate: [], accountUrl: null, log,
  }

  log.push(`${dryRun ? '[dry run] ' : ''}Building the Photo Shoot Rentals section from ${VSM_PLANET_NAME}…`)
  log.push(await preflight())

  const existing = await prisma.vendor.findUnique({
    where: { name: VSM_PLANET_NAME },
    select: {
      id: true, email: true, phone: true, partnerKind: true, catalogSection: true,
      defaultReceiveMethod: true, contactName: true, website: true, supplies: true,
      deliveryTerms: true, notes: true, lotAddress: true,
    },
  })
  result.vendorExisted = !!existing

  // Asserted every run — this is what files them under Photo Shoot Rentals
  // and stops the booking flow asking Vic for a driver he does not have.
  const asserted = {
    partnerKind: VSM_PLANET.partnerKind,
    catalogSection: VSM_PLANET.catalogSection,
    defaultReceiveMethod: receiveMethod,
  }
  result.asserted = asserted

  // Fill-if-empty — never clobber what HQ or Vic has since typed.
  const fill: Record<string, string> = {}
  const fillIfEmpty = (key: 'contactName' | 'website' | 'supplies' | 'deliveryTerms' | 'notes', value: string) => {
    if (!existing || !existing[key]) fill[key] = value
  }
  fillIfEmpty('contactName', VSM_PLANET.contactName)
  fillIfEmpty('website', VSM_PLANET.website)
  fillIfEmpty('supplies', VSM_PLANET.supplies)
  fillIfEmpty('deliveryTerms', VSM_PLANET.deliveryTerms)
  fillIfEmpty('notes', VSM_PLANET.notes)
  if (opts.email) fill.email = opts.email
  if (opts.phone) fill.phone = opts.phone
  result.filled = Object.keys(fill)

  log.push(existing ? `vendor exists (${existing.id})` : 'vendor does not exist — it will be created')
  log.push(`  assert: ${Object.entries(asserted).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
  log.push(`  fill  : ${result.filled.length ? result.filled.join(', ') : '(nothing — everything already set)'}`)

  if (dryRun && !existing) {
    log.push('[dry run] nothing written. Re-run for real to create the vendor and its roster.')
    result.wouldCreate = VSM_PLANET_ROSTER.map((u) => u.name)
    return result
  }

  const vendor = dryRun
    ? existing!
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
          ...(opts.email ? { email: opts.email } : {}),
          ...(opts.phone ? { phone: opts.phone } : {}),
        },
        select: {
          id: true, email: true, phone: true, partnerKind: true,
          catalogSection: true, defaultReceiveMethod: true,
        },
      })

  result.vendorId = vendor.id
  log.push(
    `✓ vendor ${VSM_PLANET_NAME} (${vendor.id})` +
      (dryRun ? '' : ` · ${vendor.partnerKind} · ${vendor.catalogSection} · receives ${vendor.defaultReceiveMethod}`) +
      (vendor.email ? ` · ${vendor.email}` : ' · NO EMAIL ON FILE — pass one before inviting'),
  )

  for (const u of VSM_PLANET_ROSTER) {
    const found = await prisma.subcontractedVehicle.findFirst({
      where: { vendorId: vendor.id, name: u.name },
      select: { id: true },
    })
    if (found) {
      result.existingUnitIds.push(found.id)
      log.push(`  = ${u.name} (exists)`)
      continue
    }
    if (dryRun) {
      result.wouldCreate.push(u.name)
      log.push(`  + would create ${u.name}`)
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
        // so changing how VSM hands gear over is one edit, not fourteen.
        defaultReceiveMethod: null,
        publiclyListed: false,
        offeredToSirReel: true,
      },
      select: { id: true },
    })
    result.createdUnitIds.push(created.id)
    log.push(`  + ${u.name} (${created.id})`)
  }

  if (dryRun) {
    log.push(`[dry run] nothing written. ${result.wouldCreate.length} of ${VSM_PLANET_ROSTER.length} units would be created.`)
    return result
  }

  const token = await ensureVendorPortalToken(vendor.id)
  result.accountUrl = vendorAccountUrl(token)
  log.push(`Partner account link (minted, NOT sent): ${result.accountUrl}`)
  log.push('Next, on /crm/portals#partners → VSM Planet Rentals: check the deal (35% / max 43%), file the standard Partner EQUIPMENT Agreement, then email Vic the account link so he can price the roster and add photos.')
  return result
}
