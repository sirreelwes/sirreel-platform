/**
 * team_members.user_id — ADDITIVE SQL, not `prisma db push`.
 *
 * The live DB carries objects no schema file knows (sr_job_locations, nine
 * sub_rentals columns, …), so a push from a checkout offers to DROP them.
 * Same rule as scripts/add-collector-columns.ts and the partner-column
 * scripts: add the column by hand.
 *
 * Wes 2026-09-16, the rep card on client email: linking a "Who we are"
 * roster row to its HQ login is what lets the welcome email show the same
 * photo and title the public site shows, instead of a second copy of both.
 *
 * Run BEFORE the deploy that selects the column. Until it has run,
 * resolveRepCard() fails soft — the headshot rung is skipped and the rep's
 * weekly candid still carries the card.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-team-member-user-column.ts
 *
 * Idempotent. The FK is guarded by name, and ON DELETE SET NULL because
 * removing an HQ login should unlink the roster row, never delete the
 * person from the public site.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS user_id text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS team_members_user_id_key ON team_members (user_id)`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'team_members_user_id_fkey'
     ) THEN
       ALTER TABLE team_members
         ADD CONSTRAINT team_members_user_id_fkey
         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
     END IF;
   END $$`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql.split('\n')[0].trim()}`)
  }

  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'team_members' AND column_name = 'user_id'`,
  )
  console.log('team_members.user_id:', cols.length ? 'present' : 'MISSING')

  const fk = await prisma.$queryRawUnsafe<{ conname: string }[]>(
    `SELECT conname FROM pg_constraint WHERE conname = 'team_members_user_id_fkey'`,
  )
  console.log('foreign key:', fk.length ? 'present' : 'MISSING')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
