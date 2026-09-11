/**
 * Put "Antenna" and "Battery" on the CP200 radios as per-unit checks.
 *
 *   npx tsx scripts/seed-unit-checks.ts            # dry run
 *   npx tsx scripts/seed-unit-checks.ts --write
 *   npx tsx scripts/seed-unit-checks.ts --write --include-sub   # CP200S too
 *   npx tsx scripts/seed-unit-checks.ts --write --checks "Antenna,Battery,Belt clip"
 *
 * Wes, 2026-09-11: "We need to add antenna and battery to pick lists as
 * part of the kit … each walkie needs to confirm those." These are what
 * is ATTACHED to each radio — not the spare batteries and charger that
 * ride along as kit-piece lines (scripts/seed-walkie-kit-pieces.ts).
 *
 * Idempotent and additive: the names are UNIONED onto whatever the item
 * already has (case-insensitive), nothing is removed. The same edit is
 * available by hand in the inventory drawer ("Per-unit checks").
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

// Same codes the walkie-kit seed hangs off. Codes, not names — names drift.
const RADIO_CODES = ['103733', '104387']
if (args.includes('--include-sub')) RADIO_CODES.push('CP200S')

const CHECKS = normalizeUnitChecks((strArg('--checks') ?? 'Antenna,Battery').split(','))

async function main() {
  const radios = await prisma.inventoryItem.findMany({
    where: { code: { in: RADIO_CODES } },
    select: { id: true, code: true, description: true, unitChecks: true },
  })
  const missing = RADIO_CODES.filter((c) => !radios.some((r) => r.code === c))
  if (missing.length) throw new Error(`radio codes not found in the catalog: ${missing.join(', ')}`)

  console.log(`${WRITE ? 'WRITE' : 'DRY RUN'} — per-unit checks: ${CHECKS.join(', ')}\n`)
  for (const r of radios) {
    const next = normalizeUnitChecks([...r.unitChecks, ...CHECKS])
    const changed = next.join('|') !== r.unitChecks.join('|')
    console.log(`  ${r.code}  ${r.description}`)
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
          newValues: { unitChecks: next, script: 'scripts/seed-unit-checks.ts' },
        },
      })
      console.log('    ✓ written')
    }
  }
  if (!WRITE) console.log('\nDry run — add --write to apply.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
