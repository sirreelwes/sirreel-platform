/**
 * Seed VSM Planet Rentals' photo roster — the LAPTOP entry point.
 *
 * The work itself is `seedVsmPlanet()` in src/lib/sub-rentals/seedVsmPlanet.ts,
 * shared with /admin/maintenance so a run from an iPad and a run from here do
 * exactly the same thing (Wes 2026-09-16). This file is argv, the journal
 * file and an exit code — nothing else. If you are adding behaviour, add it
 * to the lib or the phone loses it.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/onboard-vsm-planet.ts --dry
 *   npx tsx scripts/onboard-vsm-planet.ts [--email vic@… --phone 323-… --receive WILL_CALL]
 *
 * No schema change: every column written has existed since 2026-09-15. The
 * PHOTO_SHOOT enum value must already be in the DB (it went in 2026-09-11);
 * the seed preflights it and refuses rather than 500-ing the partner page.
 *
 * Exit codes: 0 done · 1 failed · 2 refused with something to fix.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { seedVsmPlanet, SeedRefused, type ReceiveMethodKey } from '../src/lib/sub-rentals/seedVsmPlanet'

const args = process.argv.slice(2)
const flag = (k: string): string | null => {
  const i = args.indexOf(k)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}

async function main() {
  const dryRun = args.includes('--dry')
  const result = await seedVsmPlanet({
    dryRun,
    email: flag('--email'),
    phone: flag('--phone'),
    receiveMethod: (flag('--receive') as ReceiveMethodKey | null) ?? null,
  })

  for (const line of result.log) console.log(line)

  if (!dryRun) {
    // The journal is the laptop's version of the AuditLog row the web path
    // writes: the captured ids, so a cleanup can only ever delete by them.
    mkdirSync('journals', { recursive: true })
    const at = new Date().toISOString()
    const file = `journals/onboard-vsm-planet-${at.replace(/[:.]/g, '-')}.json`
    writeFileSync(file, JSON.stringify({ ...result, at }, null, 2))
    console.log(`journal: ${file}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    if (e instanceof SeedRefused) {
      console.error(`\n${e.message}\n${e.fix}`)
      process.exit(2)
    }
    console.error(e)
    process.exit(1)
  })
