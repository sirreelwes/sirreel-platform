/**
 * Add INSURANCE to the LostReason enum — the laptop door.
 *
 * The WORK is `INSURANCE_LOST_REASON_DDL` + `runAdditiveDdl`, which is what
 * /admin/maintenance → "Add the insurance lost reason" runs. This file is
 * argv + exit code and nothing else, so the phone can never lose behaviour
 * a terminal has (the 2026-09-16 two-entry-point rule).
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-insurance-lost-reason.ts [--dry]
 *
 * Idempotent: ADD VALUE IF NOT EXISTS, one statement, no half-run state.
 */
import { INSURANCE_LOST_REASON_DDL } from '../src/lib/orders/lostReasonEnumSql'
import { runAdditiveDdl } from '../src/lib/admin/runAdditiveDdl'

async function main() {
  const dryRun = process.argv.includes('--dry')
  const r = await runAdditiveDdl(INSURANCE_LOST_REASON_DDL, { dryRun })
  for (const line of r.log) console.log(line)
  if (r.enumValuesMissingAfter.length && !dryRun) {
    console.error(`\nStill missing: ${r.enumValuesMissingAfter.join(', ')}`)
    process.exit(2)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
