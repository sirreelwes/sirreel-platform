/**
 * Antenna and battery as their OWN pick-list lines, one per radio —
 * the way RentalWorks prints them and the way the floor counts them.
 *
 *   npx tsx scripts/seed-radio-parts-kit.ts             # dry run
 *   npx tsx scripts/seed-radio-parts-kit.ts --write
 *   npx tsx scripts/seed-radio-parts-kit.ts --write --include-sub
 *
 * Wes, 2026-09-11: "add antenna and battery to pick lists as part of the
 * kit". The RW sheet for order 304656 is the reference — 15 radios print
 * as four lines at 15 each:
 *
 *   104387  Motorola CP200 UHF Radio (Digital) Complete   15
 *   102933  CP200 - Antenna                               15
 *   102930  CP200 - Battery                               15
 *   102938  Surveillance Kit                              15
 *
 * So these are KIT PIECES at 1-per-1 (qtyPer 1, perUnits 1), not the
 * ratio pieces the walkie-kit seed adds (spare batteries at 50%, one
 * charger per 12). Both can hang off the same radio: the 1:1 battery is
 * the one IN the radio, the 0.5 spare is the second one in the case.
 *
 * Deliberately NOT client-visible and FREE: a quote that suddenly grew
 * three extra lines per radio reads as a pricing change to the client.
 * The pick list sees them either way — membership follows the line's
 * department, not its visibility.
 *
 * The Surveillance Kit is NOT seeded: on that sheet it is what the
 * client ordered, not what the radio comes with.
 *
 * Codes are RW's own I-codes, so an item that already exists is reused
 * rather than duplicated. Idempotent: items matched by `code`, kits by
 * (parent, piece); a re-run updates. A --write run journals every id it
 * CREATED to journals/radio-parts-kit-*.json — the only safe basis for
 * an undo.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const args = process.argv.slice(2)
const WRITE = args.includes('--write')

function numArg(flag: string): number | null {
  const i = args.indexOf(flag)
  if (i === -1 || !args[i + 1]) return null
  const n = Number(args[i + 1])
  return Number.isFinite(n) ? n : null
}

/** Same parents as the walkie-kit seed. Codes, not names — names drift. */
const RADIO_CODES = ['103733', '104387']
if (args.includes('--include-sub')) RADIO_CODES.push('CP200S')

const PARTS = [
  {
    code: '102933',
    description: 'CP200 - Antenna',
    aliases: ['antenna', 'walkie antenna', 'radio antenna'],
    qty: numArg('--antenna-qty'),
    note: 'One per radio — the antenna on it.',
  },
  {
    code: '102930',
    description: 'CP200 - Battery',
    aliases: ['walkie battery', 'radio battery'],
    qty: numArg('--battery-qty'),
    // NOT "spare battery" — that alias belongs to CP200-BATTERY, the
    // 50%-ratio spare from the walkie-kit seed. Two rows, two meanings.
    note: 'One per radio — the battery in it.',
  },
]

const created = {
  items: [] as Array<{ id: string; code: string }>,
  kitPieces: [] as Array<{ id: string; parentCode: string; pieceCode: string }>,
}

async function main() {
  const radios = await prisma.inventoryItem.findMany({
    where: { code: { in: RADIO_CODES } },
    select: { id: true, code: true, description: true },
  })
  const missing = RADIO_CODES.filter((c) => !radios.some((r) => r.code === c))
  if (missing.length) throw new Error(`radio codes not found in the catalog: ${missing.join(', ')}`)

  console.log(`${WRITE ? 'WRITE' : 'DRY RUN'} — antenna + battery as 1:1 kit lines\n`)
  console.log('Parents:')
  for (const r of radios) console.log(`  ${r.code}  ${r.description}`)
  console.log()

  for (const part of PARTS) {
    let item = await prisma.inventoryItem.findUnique({
      where: { code: part.code },
      select: { id: true, code: true, description: true, qtyOwned: true, aliases: true },
    })

    if (!item) {
      // qtyOwned is a real count, never a guess: without it the item's
      // availability reads as zero owned, which is worse than absent.
      if (part.qty == null) {
        throw new Error(
          `${part.code} (${part.description}) is not in the catalog and no quantity was given. ` +
            `Re-run with --${part.code === '102933' ? 'antenna' : 'battery'}-qty N (how many are owned).`,
        )
      }
      console.log(`  + create item ${part.code}  ${part.description}  qtyOwned=${part.qty}`)
      if (WRITE) {
        const row = await prisma.inventoryItem.create({
          data: {
            code: part.code,
            description: part.description,
            qtyOwned: part.qty,
            department: 'COMMUNICATIONS',
            type: 'EQUIPMENT',
            aliases: part.aliases,
            publicVisible: false,
          },
          select: { id: true, code: true, description: true, qtyOwned: true, aliases: true },
        })
        created.items.push({ id: row.id, code: row.code })
        item = row
      }
    } else {
      console.log(`  · item ${part.code} exists — ${item.description} (${item.qtyOwned} owned)`)
      const nextAliases = [...new Set([...item.aliases, ...part.aliases])]
      if (WRITE && nextAliases.length !== item.aliases.length) {
        await prisma.inventoryItem.update({ where: { id: item.id }, data: { aliases: nextAliases } })
        console.log(`    ✓ aliases += ${part.aliases.join(', ')}`)
      }
      if (WRITE && part.qty != null && part.qty !== item.qtyOwned) {
        await prisma.inventoryItem.update({ where: { id: item.id }, data: { qtyOwned: part.qty } })
        console.log(`    ✓ qtyOwned ${item.qtyOwned} → ${part.qty}`)
      }
    }

    for (const radio of radios) {
      console.log(`    ${radio.code} → ${part.code}  1 per 1`)
      if (!WRITE || !item) continue
      const existing = await prisma.inventoryKitPiece.findUnique({
        where: { parentItemId_pieceItemId: { parentItemId: radio.id, pieceItemId: item.id } },
        select: { id: true },
      })
      const data = {
        qtyPer: 1,
        perUnits: 1,
        rounding: 'CEIL' as const,
        minQty: 0,
        billing: 'FREE' as const,
        // Warehouse-only: the client ordered radios, and a quote that
        // grows three lines per radio looks like a price change.
        clientVisible: false,
        suppressIfOrdered: true,
        note: part.note,
        isActive: true,
      }
      if (existing) {
        await prisma.inventoryKitPiece.update({ where: { id: existing.id }, data })
        console.log('      ✓ updated')
      } else {
        const row = await prisma.inventoryKitPiece.create({
          data: { parentItemId: radio.id, pieceItemId: item.id, ...data },
          select: { id: true },
        })
        created.kitPieces.push({ id: row.id, parentCode: radio.code, pieceCode: part.code })
        console.log('      ✓ created')
      }
    }
    console.log()
  }

  if (WRITE && (created.items.length || created.kitPieces.length)) {
    mkdirSync('journals', { recursive: true })
    const file = path.join('journals', `radio-parts-kit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify(created, null, 2))
    console.log(`journal: ${file}`)
  }
  if (!WRITE) console.log('Dry run — add --write to apply.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1) })
