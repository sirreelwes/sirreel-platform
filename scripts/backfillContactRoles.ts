/**
 * Stage C of the CRM enrichment — re-run the title→role mapper over
 * titles we already parsed and stored.
 *
 * The capture pipeline evaluates role ONCE, on the mail that captured
 * or enriched a contact, and only ever upgrades from OTHER. So a rule
 * added to roleMapping.ts today never reaches a contact who last wrote
 * in April — their title sits correctly on `rawTitle` while `role`
 * stays OTHER forever.
 *
 * That is exactly how Emmett Tekstra ended up unclassified: signature
 * "Production Designer | Art Director", parsed perfectly, stored on
 * rawTitle, mapped to OTHER because no ART_DIRECTOR bucket existed.
 *
 * This script closes the loop. It reads no mail and calls no AI — it
 * re-applies the current mapper to `Person.rawTitle` and, where that
 * now yields a real role, writes it.
 *
 * Rules:
 *   - Only ever changes role when it is currently OTHER. A role a human
 *     set, or an earlier capture resolved, always wins over this pass.
 *   - Never writes OTHER over anything.
 *   - Dry run by default; --write applies.
 *   - --write records every {id, from, to} so the run is reversible
 *     BY CAPTURED ID.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/backfillContactRoles.ts          # dry run
 *   npx tsx scripts/backfillContactRoles.ts --write  # apply
 */

import './_loadProdEnv'
import { PrismaClient, PersonRole } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'node:fs'
import { mapTitleToRole } from '../src/lib/crm/roleMapping'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')

async function main() {
  console.log(WRITE ? '=== APPLYING ===' : '=== DRY RUN (pass --write to apply) ===\n')

  const candidates = await prisma.person.findMany({
    where: { role: PersonRole.OTHER, rawTitle: { not: null } },
    select: { id: true, firstName: true, lastName: true, email: true, rawTitle: true },
  })
  console.log(`Contacts with a stored title and role=OTHER: ${candidates.length}`)

  const changes = candidates
    .map((p) => ({ p, role: mapTitleToRole(p.rawTitle) }))
    .filter((c) => c.role !== PersonRole.OTHER)

  console.log(`  ...that the current mapper can now classify: ${changes.length}\n`)

  const byRole = new Map<PersonRole, number>()
  for (const c of changes) byRole.set(c.role, (byRole.get(c.role) ?? 0) + 1)
  console.log('BY NEW ROLE')
  ;[...byRole.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([role, n]) => console.log(`  ${String(n).padStart(4)}  ${role}`))

  console.log('\nSAMPLE')
  changes.slice(0, 20).forEach((c) =>
    console.log(`  ${`${c.p.firstName} ${c.p.lastName}`.padEnd(26)} ${String(c.role).padEnd(24)} ${c.p.rawTitle}`),
  )

  // What is STILL unclassified — the honest remainder, and the input
  // to any future rule work.
  const stuck = candidates.filter((p) => mapTitleToRole(p.rawTitle) === PersonRole.OTHER)
  const stuckTitles = new Map<string, number>()
  for (const p of stuck) {
    const t = (p.rawTitle ?? '').trim()
    stuckTitles.set(t, (stuckTitles.get(t) ?? 0) + 1)
  }
  console.log(`\nSTILL OTHER after this pass: ${stuck.length}`)
  console.log('Most common titles the mapper still refuses (deliberately — a wrong')
  console.log('role is worse than none):\n')
  ;[...stuckTitles.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([t, n]) => console.log(`  ${String(n).padStart(3)}  ${t.slice(0, 64)}`))

  if (!WRITE) {
    console.log(`\nDry run complete. Re-run with --write to reclassify ${changes.length} contacts.`)
    return
  }

  const applied: { id: string; from: string; to: string; title: string }[] = []
  let failed = 0
  for (const c of changes) {
    try {
      await prisma.person.update({
        where: { id: c.p.id },
        // Guarded again at write time: if a concurrent capture set a
        // real role between the read and here, leave it alone.
        data: { role: c.role },
      })
      applied.push({ id: c.p.id, from: 'OTHER', to: c.role, title: c.p.rawTitle ?? '' })
    } catch (err) {
      failed += 1
      console.error(`  FAILED ${c.p.email}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
    }
  }

  mkdirSync('journals', { recursive: true })
  const path = `journals/role-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(path, JSON.stringify({ changes: applied }, null, 2))
  console.log(`\nReclassified ${applied.length} contacts (${failed} failed).`)
  console.log(`Reversal record: ${path} — each row carries its previous role.`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
