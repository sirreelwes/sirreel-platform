/**
 * sr_site_settings.rep_card_enabled — ADDITIVE SQL, not `prisma db push`.
 *
 * The live DB carries objects no schema file knows, so a push from a
 * checkout offers to DROP them. Same rule as the other add-*-column scripts.
 *
 * Wes 2026-09-16: "I want to test the system personally before we make it
 * live for team." This is that switch — the rep card on client email, OFF
 * until Wes flips it on /admin/who-we-are. While off, only a tester's own
 * jobs carry the card (src/lib/email/repCardRollout.ts).
 *
 * Run BEFORE the deploy. Until it has, repCardEnabled() fails soft to OFF,
 * which is the safe direction: client email stays exactly as it is.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/add-rep-card-rollout-column.ts
 *
 * Idempotent. Additive only — no DROP, no data touched.
 */
import { prisma } from '../src/lib/prisma'

const STATEMENTS = [
  `ALTER TABLE sr_site_settings ADD COLUMN IF NOT EXISTS rep_card_enabled boolean NOT NULL DEFAULT false`,
]

async function main() {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql)
    console.log(`✓ ${sql}`)
  }
  const cols = await prisma.$queryRawUnsafe<{ column_name: string; column_default: string }[]>(
    `SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name = 'sr_site_settings' AND column_name = 'rep_card_enabled'`,
  )
  console.log('rep_card_enabled:', cols.length ? `present (default ${cols[0].column_default})` : 'MISSING')
  console.log('\nThe card stays dark until you turn it on at /admin/who-we-are.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
