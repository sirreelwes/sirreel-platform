/**
 * Apply every checklist in src/lib/warehouse/kitChecklists.ts.
 *
 *   npx tsx scripts/seed-kit-unit-checks.ts               # dry run, all
 *   npx tsx scripts/seed-kit-unit-checks.ts --write
 *   npx tsx scripts/seed-kit-unit-checks.ts --only "DF-50"     # one package
 *   npx tsx scripts/seed-kit-unit-checks.ts --write --only "Pelican"
 *
 * Oliver, 2026-09-14, via Wes: "every item that goes out that is made up
 * of multiple parts has some sort of accountability checklist for the
 * warehouse when they're checking it out and in."
 *
 * The parts to count live in the registry, not here — adding the next
 * package is one entry there and a re-run of this. Supersedes the
 * DF-50-only seed, which was the first of these before there was a
 * second.
 *
 * WHAT A SEEDED CHECK DOES: prints under the line on the pull sheet
 * ("Each unit: ( ) Power cord ( ) Case × 2") and shows at the check-out
 * and check-in desk as a chip per part, defaulting to present, that a tap
 * marks missing (OrderUnitScan.missingOut / missingIn). Nothing here
 * touches pricing — these are not kit pieces and cannot reach a quote.
 *
 * Idempotent and additive, like scripts/seed-unit-checks.ts: names are
 * UNIONED onto whatever the row already has (case-insensitively, keeping
 * the existing spelling) and NOTHING is ever removed. Re-running is a
 * no-op. The same edit is available by hand in the inventory drawer under
 * "Per-unit checks" — which is the faster route for a one-off.
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
import { KIT_CHECKLISTS, type KitChecklist } from '../src/lib/warehouse/kitChecklists'

const prisma = new PrismaClient()
const args = process.argv.slice(2)
const WRITE = args.includes('--write')

function strArg(flag: string): string | null {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}

const ONLY = strArg('--only')
const selected: KitChecklist[] = ONLY
  ? KIT_CHECKLISTS.filter((c) => c.label.toLowerCase().includes(ONLY.toLowerCase()))
  : KIT_CHECKLISTS

async function main() {
  if (selected.length === 0) {
    throw new Error(
      `--only "${ONLY}" matched no package. Known: ${KIT_CHECKLISTS.map((c) => c.label).join(' | ')}`,
    )
  }

  const wantedCodes = [...new Set(selected.flatMap((c) => c.codes))]
  const rows = await prisma.inventoryItem.findMany({
    where: { code: { in: wantedCodes } },
    select: { id: true, code: true, description: true, unitChecks: true, isActive: true },
  })
  const byCode = new Map(rows.map((r) => [r.code, r]))

  // A code that no longer resolves means the checklist silently covers
  // nothing, which is the exact failure this whole exercise is against.
  // Report every one and refuse the run rather than seeding a subset.
  const missing = wantedCodes.filter((c) => !byCode.has(c))
  if (missing.length) {
    throw new Error(
      `these codes are not in the catalog: ${missing.join(', ')}\n` +
      `Fix them in src/lib/warehouse/kitChecklists.ts — check the inventory ` +
      `list or exports/catalog-export.json for the current code.`,
    )
  }

  console.log(`${WRITE ? 'WRITE' : 'DRY RUN'} — ${selected.length} package(s)\n`)
  let changedCount = 0

  for (const pkg of selected) {
    console.log(`${pkg.label}`)
    console.log(`  checks: ${pkg.checks.join(', ')}`)
    if (pkg.unconfirmed?.length) {
      console.log(`  NOT seeded (unconfirmed twins): ${pkg.unconfirmed.join(' | ')}`)
    }
    for (const code of pkg.codes) {
      const r = byCode.get(code)!
      const next = normalizeUnitChecks([...r.unitChecks, ...pkg.checks])
      const changed = next.join('|') !== r.unitChecks.join('|')
      console.log(`    ${code}  ${r.description}${r.isActive ? '' : '  (INACTIVE)'}`)
      console.log(`      now:  [${r.unitChecks.join(', ')}]`)
      console.log(`      next: [${next.join(', ')}]${changed ? '' : '  (no change)'}`)
      if (!changed) continue
      changedCount++
      if (!WRITE) continue
      await prisma.inventoryItem.update({ where: { id: r.id }, data: { unitChecks: next } })
      await prisma.auditLog.create({
        data: {
          userId: null,
          action: 'inventory.unit_checks_seeded',
          entityType: 'InventoryItem',
          entityId: r.id,
          oldValues: { unitChecks: r.unitChecks },
          newValues: {
            unitChecks: next,
            package: pkg.label,
            script: 'scripts/seed-kit-unit-checks.ts',
          },
        },
      })
      console.log('      ✓ written')
    }
    console.log('')
  }

  console.log(`${changedCount} row(s) ${WRITE ? 'changed' : 'would change'}.`)
  if (!WRITE) console.log('Dry run — add --write to apply.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
