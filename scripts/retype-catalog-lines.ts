/**
 * Line types put back in step with the catalog — the LAPTOP entry point.
 *
 * The work is `retypeCatalogLines()` in src/lib/orders/retypeCatalogLines.ts,
 * shared with /admin/maintenance so a run from a phone and a run from here
 * do exactly the same thing. This file is argv, the journal file and an exit
 * code — nothing else. Add behaviour to the lib or the phone loses it.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/retype-catalog-lines.ts          # dry run (default)
 *   npx tsx scripts/retype-catalog-lines.ts --write  # apply
 *
 * No schema change — it writes one enum column on lines that already exist.
 * Reversal is by the ids in the journal, and each one also has an AuditLog
 * row (`order_line_item.retyped_from_catalog`) carrying the old type.
 *
 * Exit codes: 0 done · 1 failed · 2 refused with something to fix.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { retypeCatalogLines } from '../src/lib/orders/retypeCatalogLines'
import { TaskRefused } from '../src/lib/admin/taskRefused'

async function main() {
  const dryRun = !process.argv.includes('--write')
  const result = await retypeCatalogLines({ dryRun })

  for (const line of result.log) console.log(line)
  if (result.warnings.length) {
    console.log('\nLook at:')
    for (const w of result.warnings) console.log(`  ! ${w}`)
  }

  if (!dryRun) {
    mkdirSync('journals', { recursive: true })
    const at = new Date().toISOString()
    const file = `journals/retype-catalog-lines-${at.replace(/[:.]/g, '-')}.json`
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
