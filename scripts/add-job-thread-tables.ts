/**
 * Add the two job-Conversation tables with ADDITIVE SQL, not `prisma db
 * push` (the live DB carries objects in no schema file; a push would drop
 * them). The laptop door; the phone door is /admin/maintenance → "Create
 * the job Conversation tables". Both run `JOB_THREAD_TABLES_DDL` through
 * `runAdditiveDdl` — one implementation.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-job-thread-tables.ts [--dry]
 *
 * Idempotent: every statement is IF NOT EXISTS. Until it has run, the
 * Conversation panel still shows the emails (they live in email_messages)
 * and the notes / claim controls report that this is needed.
 */
import { runAdditiveDdl } from '../src/lib/admin/runAdditiveDdl'
import { JOB_THREAD_TABLES_DDL } from '../src/lib/email/jobThreadTableSql'
import { TaskRefused } from '../src/lib/admin/taskRefused'

async function main() {
  const dryRun = process.argv.includes('--dry')
  const r = await runAdditiveDdl(JOB_THREAD_TABLES_DDL, { dryRun })
  for (const line of r.log) console.log(line)
  if (r.missingAfter.length && !dryRun) process.exit(1)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    if (e instanceof TaskRefused) {
      console.error(`Refused: ${e.message}\n  fix: ${e.fix}`)
      process.exit(2)
    }
    console.error(e)
    process.exit(1)
  })
