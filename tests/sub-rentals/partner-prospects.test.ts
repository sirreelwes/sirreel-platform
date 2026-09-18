/**
 * The partner PROSPECT registry — what the onboarding script queues from and
 * markAsPartner() seeds from.
 *
 * The invariants that hold for every cohort:
 *
 *   · slugs and vendor names are unique (Vendor.name is the upsert key —
 *     a duplicate would fold two companies into one row);
 *   · every roster unit sits in a real partner catalog section, and the
 *     vendor's default section is where its roster LEADS — the default is
 *     what a unit added later inherits, so a default nothing sits in is a
 *     trap;
 *   · kind and receive method are real enum values: they are written
 *     straight onto the Vendor row, and a bad one is a 500 on the partner
 *     page, not a type error;
 *   · no unit ships with a rate (partners propose; HQ accepts);
 *   · a unit only talks about a DRIVER when the prospect actually sends one
 *     (PICKUP). This used to be asserted as "delivered, never driven" for
 *     every row, which was true only while every prospect was an equipment
 *     house;
 *   · an email is either absent or a real address — the introduction goes
 *     to whatever is here, so a guessed one is worse than none;
 *   · the lookup is case- and whitespace-tolerant, since it reads argv.
 *
 * Plus the one thing about Suppose U Drive that is a DECISION and not a
 * detail: stake beds and 5-tons only (Wes 2026-09-18). Their real fleet runs
 * to cargo vans and box trucks that SirReel already owns, so a roster that
 * grew toward their catalog would put our own classes on our own page under
 * a partner's heading. That is what this pins.
 *
 * Run: npm run test:partner-prospects
 */
import { PARTNER_PROSPECTS, findPartnerProspect, findPartnerProspectByName } from '@/lib/sub-rentals/partnerProspects'
import { isPartnerSectionKey } from '@/lib/site/partnerSections'
import { isPartnerKind, isReceiveMethod, usesPartnerDriver } from '@/lib/sub-rentals/partnerKind'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

const slugs = PARTNER_PROSPECTS.map((c) => c.slug)
const names = PARTNER_PROSPECTS.map((c) => c.name)
yes('at least one prospect', PARTNER_PROSPECTS.length > 0)
eq('slugs unique', new Set(slugs).size, slugs.length)
eq('vendor names unique', new Set(names).size, names.length)
yes('slugs are lower-case cli keys', slugs.every((s) => /^[a-z0-9-]+$/.test(s)))
yes('no prospect is an existing partner', !names.some((n) => /power ?trip|king kong|vsm/i.test(n)))

for (const c of PARTNER_PROSPECTS) {
  yes(`${c.slug}: website is https`, /^https:\/\//.test(c.website))
  yes(`${c.slug}: email absent or well-formed`, c.email == null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email))
  yes(`${c.slug}: has a roster`, c.roster.length > 0)
  yes(`${c.slug}: says why`, c.fit.length > 20)

  yes(`${c.slug}: kind is a real PartnerKind`, isPartnerKind(c.partnerKind))
  yes(`${c.slug}: default section is a real section`, isPartnerSectionKey(c.catalogSection))
  yes(`${c.slug}: receive method is a real one`, isReceiveMethod(c.defaultReceiveMethod))

  const unitNames = c.roster.map((u) => u.name)
  eq(`${c.slug}: unit names unique`, new Set(unitNames).size, unitNames.length)
  yes(`${c.slug}: every unit in a real section`, c.roster.every((u) => isPartnerSectionKey(u.section)))
  yes(`${c.slug}: the roster leads with the vendor default section`, c.roster[0].section === c.catalogSection)
  yes(`${c.slug}: no unit carries a rate`, c.roster.every((u) => !('listDailyRate' in u) && !('listWeeklyRate' in u)))
  yes(`${c.slug}: every unit has a client blurb`, c.roster.every((u) => u.publicDescription.length > 30))

  // A driver is promised only by a partner who sends one.
  const sendsDriver = c.roster.every((u) => usesPartnerDriver(u.defaultReceiveMethod ?? c.defaultReceiveMethod))
  if (!sendsDriver) {
    yes(
      `${c.slug}: no unit promises a driver they do not send`,
      c.roster.every((u) => !/\bdriver\b/i.test(u.publicDescription)),
    )
  }
}

// ── Suppose U Drive: the scope IS the decision ───────────────────────────
const sud = findPartnerProspect('suppose-u-drive')!
yes('suppose u drive is in the registry', !!sud)
eq('they are a vehicles partner, not equipment', sud.partnerKind, 'VEHICLES')
eq('a counter business: the production collects', sud.defaultReceiveMethod, 'WILL_CALL')
eq('their units land under the trucks heading', sud.catalogSection, 'PRODUCTION_TRUCKS')
yes('every unit is a truck, not a section of its own', sud.roster.every((u) => u.section === 'PRODUCTION_TRUCKS'))
yes(
  'stake beds and 5-tons only — nothing SirReel already owns',
  sud.roster.every((u) => /stake bed|5-ton/i.test(u.name)),
)
yes(
  'no cargo van, cube truck or specialty vehicle crept onto the roster',
  !sud.roster.some((u) => /cargo van|cube|supercube|passenger|motorhome|trailer|tractor|pickup/i.test(u.name)),
)
yes('nobody there sends a driver to set', !usesPartnerDriver(sud.defaultReceiveMethod))
yes('no email was guessed for them', sud.email === null)
yes('the 5-ton ambiguity is flagged for the call', /5-ton/i.test(sud.caveat ?? '') && (sud.caveat ?? '').length > 80)

// ── lookups ──────────────────────────────────────────────────────────────
eq('lookup tolerates case and space', findPartnerProspect('  SANISET ')?.slug, 'saniset')
eq('lookup finds the new cohort too', findPartnerProspect(' Suppose-U-Drive ')?.slug, 'suppose-u-drive')
eq('unknown slug is null', findPartnerProspect('nope'), null)
eq('a marked vendor finds its roster by name', findPartnerProspectByName('saniset fleet')?.slug, 'saniset')
eq('the spelling on the sign is the upsert key', findPartnerProspectByName('Suppose U Drive')?.slug, 'suppose-u-drive')
eq('a vendor not in the registry seeds nothing', findPartnerProspectByName('King Kong'), null)

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
