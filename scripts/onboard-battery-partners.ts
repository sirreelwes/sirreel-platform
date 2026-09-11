/**
 * Queue up a partner portal for one or more BATTERY-POWER candidates —
 * the PowerTrip onboarding (scripts/onboard-power-trip.ts), generalised
 * over the registry in scripts/battery-partner-candidates.ts.
 *
 * Wes 2026-09-10: "find me a Los Angeles based battery powered generator
 * [company that] rents to productions in Los Angeles and Q up a partner
 * portal for me with them … if there are more than one options, give me
 * those so I can select them or even possibly send to all of them."
 *
 * So this takes a selection. For each chosen candidate, idempotently:
 *   1. Upserts the Vendor row by name — kind EQUIPMENT, default catalog
 *      section Power & Generators, website, yard address, what they supply,
 *      the research notes. Email/phone land only when the registry has a
 *      quotable one or you pass --email / --phone (never clobbers a contact
 *      HQ has since set).
 *   2. Seeds a starter roster of SubcontractedVehicle rows, one per
 *      (vendor, name). Rates EMPTY on purpose — the partner proposes from
 *      their page, HQ accepts. Every unit DELIVERY, unlisted, with a
 *      staff-only placeholder note. Nothing reaches sirreel.com until a unit
 *      is listed, has a photo, AND the agreement is signed.
 *   3. Mints the partner's account link (Vendor.portalToken). Minting is
 *      SILENT: the vendor then shows on /crm/portals#vendor, where Wes sets
 *      the deal, sends the introduction (his alone to send — the account
 *      link is locked until it goes), files the standard Partner Equipment
 *      Agreement and emails the link.
 *
 * Writes a journal of every id it created
 * (journals/onboard-battery-partners-*.json) so cleanup is by captured id.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/onboard-battery-partners.ts --list
 *   npx tsx scripts/onboard-battery-partners.ts --only saniset --dry
 *   npx tsx scripts/onboard-battery-partners.ts --only saniset --only greenlite
 *   npx tsx scripts/onboard-battery-partners.ts --all
 *   npx tsx scripts/onboard-battery-partners.ts --only saniset --email saniset=rentals@… --phone saniset=818-…
 */

import { writeFileSync, mkdirSync } from 'fs'
import { BATTERY_PARTNER_CANDIDATES, findBatteryPartnerCandidate, type BatteryPartnerCandidate } from './battery-partner-candidates'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const LIST = args.includes('--list')
const ALL = args.includes('--all')

/** Every value after a repeated flag: `--only a --only b` → ['a', 'b']. */
function flagAll(k: string): string[] {
  const out: string[] = []
  args.forEach((a, i) => {
    if (a === k && args[i + 1] && !args[i + 1].startsWith('--')) out.push(args[i + 1])
  })
  return out
}

/** `--email saniset=addr` → { saniset: 'addr' }. A bare value with ONE
 *  selected candidate is taken for that candidate. */
function perCandidate(k: string, selected: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of flagAll(k)) {
    const eq = raw.indexOf('=')
    if (eq > 0) out[raw.slice(0, eq).trim().toLowerCase()] = raw.slice(eq + 1).trim()
    else if (selected.length === 1) out[selected[0]] = raw.trim()
    else throw new Error(`${k} needs slug=value when more than one candidate is selected (got "${raw}")`)
  }
  return out
}

function printList() {
  console.log('Battery-power partner candidates (ranked):\n')
  BATTERY_PARTNER_CANDIDATES.forEach((c, i) => {
    console.log(`${i + 1}. ${c.name}  [--only ${c.slug}]`)
    console.log(`   ${c.website}${c.phone ? ` · ${c.phone}` : ''}${c.email ? ` · ${c.email}` : ' · no public email'}`)
    if (c.lotAddress) console.log(`   ${c.lotAddress}`)
    console.log(`   Fit: ${c.fit}`)
    if (c.caveat) console.log(`   Watch: ${c.caveat}`)
    console.log(`   Roster seed: ${c.roster.map((u) => u.name).join(' · ')}\n`)
  })
}

async function onboard(c: BatteryPartnerCandidate, email: string | undefined, phone: string | undefined) {
  // Imported lazily so --list and --dry-without-DB never touch Prisma.
  const { prisma } = await import('../src/lib/prisma')
  const { ensureVendorPortalToken, vendorAccountUrl } = await import('../src/lib/sub-rentals/vendorAccount')

  const journal: { slug: string; vendorId: string | null; createdUnitIds: string[]; existingUnitIds: string[]; portalUrl: string | null; at: string } = {
    slug: c.slug, vendorId: null, createdUnitIds: [], existingUnitIds: [], portalUrl: null, at: new Date().toISOString(),
  }
  const placeholderNote = `Seeded by scripts/onboard-battery-partners.ts (2026-09-10) from ${c.name}’s public listings. Confirm the exact model, capacity and rates with ${c.contactName ?? 'the partner'} before quoting; rates are proposed by the partner from their account page.`

  const base = {
    contactName: c.contactName,
    website: c.website,
    supplies: c.supplies,
    lotAddress: c.lotAddress,
    deliveryTerms: c.deliveryTerms,
    partnerKind: 'EQUIPMENT' as const,
    catalogSection: 'POWER_GENERATORS' as const,
    ...(email ?? c.email ? { email: email ?? c.email } : {}),
    ...(phone ?? c.phone ? { phone: phone ?? c.phone } : {}),
  }

  const existing = await prisma.vendor.findUnique({ where: { name: c.name }, select: { id: true, email: true, phone: true, partnerKind: true } })
  if (DRY) console.log(existing ? `vendor exists (${existing.id}) — would update kind/section/details` : 'would create vendor', base)
  const vendor = DRY
    ? existing
    : await prisma.vendor.upsert({
        where: { name: c.name },
        update: base,
        create: { name: c.name, ...base, notes: c.notes },
        select: { id: true, email: true, phone: true, partnerKind: true },
      })
  if (!vendor) { console.log(`  (dry run, ${c.name} not in the DB yet — would create it and ${c.roster.length} units)`); return }
  journal.vendorId = vendor.id
  console.log(`✓ vendor ${c.name} (${vendor.id}) · ${vendor.partnerKind}${vendor.email ? ` · ${vendor.email}` : ' · NO EMAIL YET — set it on /crm/portals before the introduction'}`)

  for (const u of c.roster) {
    const found = await prisma.subcontractedVehicle.findFirst({ where: { vendorId: vendor.id, name: u.name }, select: { id: true } })
    if (found) { journal.existingUnitIds.push(found.id); console.log(`  = ${u.name} (exists)`); continue }
    if (DRY) { console.log(`  + would create ${u.name} [${u.section}]`); continue }
    const created = await prisma.subcontractedVehicle.create({
      data: {
        vendorId: vendor.id,
        name: u.name,
        vehicleType: u.vehicleType,
        description: placeholderNote,
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
    console.log(`  account link (minted, NOT sent): ${journal.portalUrl}`)
    mkdirSync('journals', { recursive: true })
    const file = `journals/onboard-battery-partners-${c.slug}-${journal.at.replace(/[:.]/g, '-')}.json`
    writeFileSync(file, JSON.stringify(journal, null, 2))
    console.log(`  journal: ${file}`)
  }
}

async function main() {
  if (LIST || (!ALL && flagAll('--only').length === 0)) {
    printList()
    if (!LIST) console.log('Pick with --only <slug> (repeatable) or --all. Add --dry to preview.')
    return
  }
  const selected = ALL ? BATTERY_PARTNER_CANDIDATES.map((c) => c.slug) : flagAll('--only').map((s) => s.trim().toLowerCase())
  const unknown = selected.filter((s) => !findBatteryPartnerCandidate(s))
  if (unknown.length) throw new Error(`unknown candidate(s): ${unknown.join(', ')} — try --list`)
  const emails = perCandidate('--email', selected)
  const phones = perCandidate('--phone', selected)

  console.log(`${DRY ? '[dry run] ' : ''}Onboarding ${selected.length} battery-power partner${selected.length === 1 ? '' : 's'}…\n`)
  for (const slug of selected) {
    const c = findBatteryPartnerCandidate(slug)!
    await onboard(c, emails[slug], phones[slug])
    console.log('')
  }
  if (!DRY) console.log('Next, on /crm/portals#vendor for each partner: set the deal (% to SirReel), send the introduction (Wes), file the standard Partner Equipment Agreement, then "Email the account link".')
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
