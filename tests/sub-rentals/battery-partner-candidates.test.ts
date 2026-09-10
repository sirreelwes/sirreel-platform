/**
 * Battery-power partner candidates (2026-09-10) — the registry the
 * onboarding script seeds from, asserted:
 *
 *   · slugs and vendor names are unique (Vendor.name is the upsert key —
 *     a duplicate would fold two companies into one row);
 *   · every roster unit sits in a real partner catalog section, and a
 *     battery outfit's units default to Power & Generators;
 *   · no unit ships with a rate (partners propose; HQ accepts) and every
 *     unit is written for delivery, not a driver;
 *   · an email is either absent or a real address — the introduction goes
 *     to whatever is here, so a guessed one is worse than none;
 *   · the lookup is case- and whitespace-tolerant, since it reads argv.
 *
 * Run: npm run test:battery-candidates
 */
import { BATTERY_PARTNER_CANDIDATES, findBatteryPartnerCandidate } from '../../scripts/battery-partner-candidates'
import { isPartnerSectionKey } from '@/lib/site/partnerSections'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

const slugs = BATTERY_PARTNER_CANDIDATES.map((c) => c.slug)
const names = BATTERY_PARTNER_CANDIDATES.map((c) => c.name)
yes('at least one candidate', BATTERY_PARTNER_CANDIDATES.length > 0)
eq('slugs unique', new Set(slugs).size, slugs.length)
eq('vendor names unique', new Set(names).size, names.length)
yes('slugs are lower-case cli keys', slugs.every((s) => /^[a-z0-9-]+$/.test(s)))
yes('no candidate is an existing partner', !names.some((n) => /power ?trip|king kong/i.test(n)))

for (const c of BATTERY_PARTNER_CANDIDATES) {
  yes(`${c.slug}: website is https`, /^https:\/\//.test(c.website))
  yes(`${c.slug}: email absent or well-formed`, c.email == null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email))
  yes(`${c.slug}: has a roster`, c.roster.length > 0)
  yes(`${c.slug}: says why`, c.fit.length > 20)
  const unitNames = c.roster.map((u) => u.name)
  eq(`${c.slug}: unit names unique`, new Set(unitNames).size, unitNames.length)
  yes(`${c.slug}: every unit in a real section`, c.roster.every((u) => isPartnerSectionKey(u.section)))
  yes(`${c.slug}: leads with power`, c.roster[0].section === 'POWER_GENERATORS')
  yes(`${c.slug}: no unit carries a rate`, c.roster.every((u) => !('listDailyRate' in u) && !('listWeeklyRate' in u)))
  yes(`${c.slug}: units are delivered, never driven`, c.roster.every((u) => !/driver/i.test(u.specs.join(' ') + u.publicDescription)))
  yes(`${c.slug}: every unit has a client blurb`, c.roster.every((u) => u.publicDescription.length > 30))
}

eq('lookup tolerates case and space', findBatteryPartnerCandidate('  SANISET ')?.slug, 'saniset')
eq('unknown slug is null', findBatteryPartnerCandidate('nope'), null)

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
