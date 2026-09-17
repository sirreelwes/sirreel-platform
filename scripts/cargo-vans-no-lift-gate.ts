/**
 * Cargo 20–25 have no lift gate — the LAPTOP entry point.
 *
 * The work is `moveCargoOffLiftGate()` in src/lib/fleet/moveCargoOffLiftGate.ts,
 * shared with /admin/maintenance so a run from an iPad and a run from here do
 * exactly the same thing. This file is argv, the journal file and an exit
 * code — nothing else. Add behaviour to the lib or the phone loses it.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/cargo-vans-no-lift-gate.ts          # dry run (default)
 *   npx tsx scripts/cargo-vans-no-lift-gate.ts --write  # apply
 *
 * No schema change. Reversal is by the ids in the journal: a moved row goes
 * back to its old categoryId / catalogItemId; a folded duplicate gets its
 * old unitName / status / isActive back and its history rows re-pointed by
 * the counts recorded — every before-value is in the journal and in the
 * per-asset AuditLog rows (`asset.category_moved`, `asset.folded_into`).
 *
 * Exit codes: 0 done · 1 failed · 2 refused with something to fix.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { moveCargoOffLiftGate } from '../src/lib/fleet/moveCargoOffLiftGate'
import { TaskRefused } from '../src/lib/admin/taskRefused'

async function main() {
  const dryRun = !process.argv.includes('--write')
  const result = await moveCargoOffLiftGate({ dryRun, actorUserId: null })

  for (const line of result.log) console.log(line)
  if (result.warnings.length) {
    console.log('\nLook at:')
    for (const w of result.warnings) console.log(`  ! ${w}`)
  }

  if (!dryRun) {
    mkdirSync('journals', { recursive: true })
    const at = new Date().toISOString()
    const file = `journals/cargo-vans-no-lift-gate-${at.replace(/[:.]/g, '-')}.json`
    writeFileSync(file, JSON.stringify({ ...result, at }, null, 2))
    console.log(`journal: ${file}`)
  } else {
    console.log('\ndry run — pass --write to apply')
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    if (e instanceof TaskRefused) {
      console.error(`\n${e.message}\n${e.fix}`)
      process.exit(2)
    }
    console.error(e)
    process.exit(1)
  })
