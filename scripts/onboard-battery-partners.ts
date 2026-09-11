/**
 * Queue partner PROSPECTS — a Vendor row each, so the introduction can be
 * sent from /crm/portals#vendor. Nothing more.
 *
 * Wes 2026-09-11: "no company gets onboarded until they reply and I mark it
 * as a new partner." So this no longer seeds a roster or mints an account
 * link (it did on 2026-09-10, in the PowerTrip mould). The roster and the
 * link come from "Mark as new partner" on the Portals tab, after they reply
 * — markAsPartner() in src/lib/sub-rentals/partnerStage.ts, reading the same
 * registry this does (src/lib/sub-rentals/partnerProspects.ts).
 *
 * For each chosen prospect, idempotently:
 *   1. Upserts the Vendor row by name — kind EQUIPMENT, default catalog
 *      section Power & Generators, website, yard address, what they supply,
 *      the research notes. Email/phone land only when the registry has a
 *      quotable one or you pass --email / --phone (never clobbers a contact
 *      HQ has since set).
 *   2. Stamps partnerProspectAt if it is not set, so the Portals tab lists
 *      them under Partner accounts with a "Prospect" chip.
 *
 * Then, on /crm/portals#vendor → the company: send the introduction (Wes).
 * When they reply: "Mark as new partner" → deal → standard Partner Equipment
 * Agreement → email the account link.
 *
 * Writes a journal of the vendor id per prospect
 * (journals/onboard-battery-partners-*.json).
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-partner-prospect-columns.ts        # once
 *   npx tsx scripts/onboard-battery-partners.ts --list
 *   npx tsx scripts/onboard-battery-partners.ts --only saniset --dry
 *   npx tsx scripts/onboard-battery-partners.ts --only saniset --only greenlite
 *   npx tsx scripts/onboard-battery-partners.ts --all
 *   npx tsx scripts/onboard-battery-partners.ts --only saniset --email saniset=steve@… --phone saniset=818-…
 */

import { writeFileSync, mkdirSync } from 'fs'
import { PARTNER_PROSPECTS, findPartnerProspect, type PartnerProspect } from '../src/lib/sub-rentals/partnerProspects'

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
 *  selected prospect is taken for that prospect. */
function perProspect(k: string, selected: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of flagAll(k)) {
    const eq = raw.indexOf('=')
    if (eq > 0) out[raw.slice(0, eq).trim().toLowerCase()] = raw.slice(eq + 1).trim()
    else if (selected.length === 1) out[selected[0]] = raw.trim()
    else throw new Error(`${k} needs slug=value when more than one prospect is selected (got "${raw}")`)
  }
  return out
}

function printList() {
  console.log('Partner prospects (ranked):\n')
  PARTNER_PROSPECTS.forEach((c, i) => {
    console.log(`${i + 1}. ${c.name}  [--only ${c.slug}]`)
    console.log(`   ${c.website}${c.phone ? ` · ${c.phone}` : ''}${c.email ? ` · ${c.email}` : ' · no public email'}`)
    if (c.lotAddress) console.log(`   ${c.lotAddress}`)
    console.log(`   Fit: ${c.fit}`)
    if (c.caveat) console.log(`   Watch: ${c.caveat}`)
    console.log(`   Roster once marked: ${c.roster.map((u) => u.name).join(' · ')}\n`)
  })
}

async function queue(c: PartnerProspect, email: string | undefined, phone: string | undefined) {
  // Imported lazily so --list never touches Prisma.
  const { prisma } = await import('../src/lib/prisma')

  const journal: { slug: string; vendorId: string | null; created: boolean; at: string } = {
    slug: c.slug, vendorId: null, created: false, at: new Date().toISOString(),
  }

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

  let existing: { id: string; email: string | null; partnerProspectAt: Date | null; partnerMarkedAt: Date | null; welcomeSentAt: Date | null } | null
  try {
    existing = await prisma.vendor.findUnique({ where: { name: c.name }, select: { id: true, email: true, partnerProspectAt: true, partnerMarkedAt: true, welcomeSentAt: true } })
  } catch {
    throw new Error('The partner stage columns are not in the database yet — run scripts/add-partner-prospect-columns.ts first.')
  }
  if (DRY) {
    console.log(existing ? `vendor exists (${existing.id}) — would update details${existing.partnerProspectAt ? '' : ' and stamp partnerProspectAt'}` : 'would create the prospect', base)
    return
  }
  const vendor = await prisma.vendor.upsert({
    where: { name: c.name },
    update: base,
    create: { name: c.name, ...base, notes: c.notes, partnerProspectAt: new Date() },
    select: { id: true, email: true, partnerProspectAt: true, partnerMarkedAt: true, welcomeSentAt: true },
  })
  journal.vendorId = vendor.id
  journal.created = !existing
  if (!vendor.partnerProspectAt) {
    await prisma.vendor.update({ where: { id: vendor.id }, data: { partnerProspectAt: new Date() } })
  }
  const stage = vendor.partnerMarkedAt ? 'partner (already marked)' : vendor.welcomeSentAt ? 'introduced — waiting on their reply' : 'prospect — send the introduction'
  console.log(`✓ ${c.name} (${vendor.id}) · ${stage}${vendor.email ? ` · ${vendor.email}` : ' · NO EMAIL YET — set it on /crm/portals before the introduction'}`)

  mkdirSync('journals', { recursive: true })
  const file = `journals/onboard-battery-partners-${c.slug}-${journal.at.replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify(journal, null, 2))
  console.log(`  journal: ${file}`)
}

async function main() {
  if (LIST || (!ALL && flagAll('--only').length === 0)) {
    printList()
    if (!LIST) console.log('Pick with --only <slug> (repeatable) or --all. Add --dry to preview.')
    return
  }
  const selected = ALL ? PARTNER_PROSPECTS.map((c) => c.slug) : flagAll('--only').map((s) => s.trim().toLowerCase())
  const unknown = selected.filter((s) => !findPartnerProspect(s))
  if (unknown.length) throw new Error(`unknown prospect(s): ${unknown.join(', ')} — try --list`)
  const emails = perProspect('--email', selected)
  const phones = perProspect('--phone', selected)

  console.log(`${DRY ? '[dry run] ' : ''}Queueing ${selected.length} partner prospect${selected.length === 1 ? '' : 's'}…\n`)
  for (const slug of selected) {
    const c = findPartnerProspect(slug)!
    await queue(c, emails[slug], phones[slug])
    console.log('')
  }
  if (!DRY) console.log('Next, on /crm/portals#vendor: send the introduction (Wes). When they reply, "Mark as new partner" — that seeds the roster and mints the link — then the deal, the standard Partner Equipment Agreement, and "Email the account link".')
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
