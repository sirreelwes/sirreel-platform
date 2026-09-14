/**
 * Put the DF-50's attached parts on the hazer rows as per-unit checks.
 *
 *   npx tsx scripts/seed-df50-unit-checks.ts            # dry run
 *   npx tsx scripts/seed-df50-unit-checks.ts --write
 *   npx tsx scripts/seed-df50-unit-checks.ts --write --checks "Remote controller,Power cord,Case"
 *   npx tsx scripts/seed-df50-unit-checks.ts --write --codes "104417,104418"
 *
 * Oliver, 2026-09-14, via Wes: "DF-50 (water and oil): come with remote
 * controller, remote, power cord, and case … trying to update so that
 * every item that goes out that is made up of multiple parts has some
 * sort of accountability checklist for the warehouse when they're
 * checking it out and in."
 *
 * "remote controller, remote" is ONE item, not two (Wes confirmed
 * 2026-09-14) — so the list is three things, not four.
 *
 * WHY PER-UNIT CHECKS AND NOT KIT PIECES: a kit piece resolves to a real
 * catalog row and becomes its own order line. There is no catalog row for
 * a DF-50 remote, cord or case, and there should not be — nobody rents
 * them separately and nobody prices them. Per-unit checks are the
 * mechanism for exactly that: parts that never get their own line. They
 * print under the line on the pull sheet ("Each unit: ( ) Case × 2") and
 * show at the desk as tap-to-mark-missing chips on BOTH edges, which is
 * the check-out AND check-in accountability Oliver asked for.
 *
 * WHY EVERY DF-50 ROW: the catalog carries the same machine more than
 * once — an RW import (numeric codes, not publicVisible) beside a
 * hand-entered public row (EFX-* codes). A check attaches to ONE row, so
 * seeding only one twin means an order built off the other gets no
 * checklist and nobody finds out. Seeding all of them costs nothing and
 * removes the trap. The duplicates are worth merging one day; that is a
 * separate job and should not block this one.
 *
 * Idempotent and additive, like scripts/seed-unit-checks.ts: the names
 * are UNIONED onto whatever the row already has (case-insensitive) and
 * nothing is ever removed. The same edit is available by hand in the
 * inventory drawer under "Per-unit checks" — which is where Oliver should
 * add the next one rather than waiting on a script.
 *
 * Needs the columns from scripts/add-unit-checks-columns.ts first.
 */
import { readFileSync } from 'fs'
import path from 'path'
const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
import { PrismaClient } from '@prisma/client'
import { normalizeUnitChecks } from '../src/lib/warehouse/unitScanRules'

const prisma = new PrismaClient()
const args = process.argv.slice(2)
const WRITE = args.includes('--write')

function strArg(flag: string): string | null {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}

/**
 * Codes, not names — names drift, and two of these rows were imported
 * with their NAME as their code, so the spelling is load-bearing.
 * Sourced from exports/catalog-export.json; a dry run is what proves
 * they still resolve, which is why dry run is the default.
 */
const DF50_CODES = (strArg('--codes') ?? 'EFX-DF50-HAZER,104417,104418')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean)

const CHECKS = normalizeUnitChecks(
  (strArg('--checks') ?? 'Remote controller,Power cord,Case').split(','),
)

async function main() {
  const rows = await prisma.inventoryItem.findMany({
    where: { code: { in: DF50_CODES } },
    select: { id: true, code: true, description: true, unitChecks: true, isActive: true },
  })

  // Report every code that did not resolve and STOP. Seeding two of three
  // DF-50 rows is the failure this script exists to prevent, so a drifted
  // code must not be something you discover from a quiet partial run.
  const missing = DF50_CODES.filter((c) => !rows.some((r) => r.code === c))
  if (missing.length) {
    throw new Error(
      `these codes are not in the catalog: ${missing.join(', ')}\n` +
      `Check exports/catalog-export.json or the inventory list, then re-run with ` +
      `--codes "<the real ones>".`,
    )
  }

  console.log(`${WRITE ? 'WRITE' : 'DRY RUN'} — per-unit checks: ${CHECKS.join(', ')}\n`)
  for (const r of rows) {
    const next = normalizeUnitChecks([...r.unitChecks, ...CHECKS])
    const changed = next.join('|') !== r.unitChecks.join('|')
    console.log(`  ${r.code}  ${r.description}${r.isActive ? '' : '  (INACTIVE)'}`)
    console.log(`    now:  [${r.unitChecks.join(', ')}]`)
    console.log(`    next: [${next.join(', ')}]${changed ? '' : '  (no change)'}`)
    if (WRITE && changed) {
      await prisma.inventoryItem.update({ where: { id: r.id }, data: { unitChecks: next } })
      await prisma.auditLog.create({
        data: {
          userId: null,
          action: 'inventory.unit_checks_seeded',
          entityType: 'InventoryItem',
          entityId: r.id,
          oldValues: { unitChecks: r.unitChecks },
          newValues: { unitChecks: next, script: 'scripts/seed-df50-unit-checks.ts' },
        },
      })
      console.log('    ✓ written')
    }
  }
  if (!WRITE) console.log('\nDry run — add --write to apply.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
