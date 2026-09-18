/**
 * The DF-50's power cord onto the machine — the LAPTOP entry point.
 *
 * The work is `moveDf50Cord()` in src/lib/inventory/moveDf50Cord.ts, shared
 * with /admin/maintenance so a run from an iPad and a run from here do
 * exactly the same thing. This file is argv, the journal file and an exit
 * code — nothing else. Add behaviour to the lib or the phone loses it.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/move-df50-cord.ts          # dry run (default)
 *   npx tsx scripts/move-df50-cord.ts --write  # apply
 *
 * No schema change. Reversal is by the ids in the journal: set the
 * deactivated link active again and deactivate the ones created. Every id
 * is in the journal and in the AuditLog rows (`inventory.kit_piece_moved`).
 *
 * Exit codes: 0 done · 1 failed · 2 refused with something to fix.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { moveDf50Cord } from '../src/lib/inventory/moveDf50Cord'
import { TaskRefused } from '../src/lib/admin/taskRefused'

async function main() {
  const dryRun = !process.argv.includes('--write')
  const result = await moveDf50Cord({ dryRun })

  for (const line of result.log) console.log(line)
  if (result.warnings.length) {
    console.log('\nLook at:')
    for (const w of result.warnings) console.log(`  ! ${w}`)
  }

  if (!dryRun) {
    mkdirSync('journals', { recursive: true })
    const at = new Date().toISOString()
    const file = `journals/move-df50-cord-${at.replace(/[:.]/g, '-')}.json`
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
