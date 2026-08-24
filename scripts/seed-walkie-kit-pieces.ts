/**
 * Attach the walkie kit to the CP200 radios as real included accessories.
 *
 *   npx tsx scripts/seed-walkie-kit-pieces.ts          # dry run
 *   npx tsx scripts/seed-walkie-kit-pieces.ts --write
 *
 * Why this isn't already done: the charging bank and the spare battery
 * have never existed as catalog rows. The kit shipped as hardcoded text
 * lines (src/lib/sales/walkieKit.ts), so there was nothing to link. This
 * script creates the two rows — quantities and replacement costs are
 * arguments, NOT guesses — and hangs them off all three CP200 rows with
 * Wes's ratios (2026-08-17): 50% spare batteries, one bank per 12.
 *
 *   --bank-qty N        units of the 6-bank charger owned
 *   --battery-qty N     spare batteries owned
 *   --bank-cost N       replacement cost each (optional)
 *   --battery-cost N    replacement cost each (optional)
 *
 * Idempotent: items are matched by `code` and kits by (parent, piece),
 * so a re-run updates rather than duplicates. Nothing is deleted.
 */

import { readFileSync } from 'fs'
import path from 'path'

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

import { PrismaClient, type Prisma } from '@prisma/client'

const prisma = new PrismaClient()

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
function numArg(flag: string): number | null {
  const i = args.indexOf(flag)
  if (i === -1 || !args[i + 1]) return null
  const n = Number(args[i + 1])
  return Number.isFinite(n) ? n : null
}

// The three radios the kit hangs off. Codes, not names — names drift.
const RADIO_CODES = ['103733', '104387', 'CP200S']

const PIECES = [
  {
    code: 'CP200-CHARGER-6BANK',
    description: 'Motorola CP200 6-Bank Charger',
    qty: numArg('--bank-qty'),
    cost: numArg('--bank-cost'),
    // One per 12 radios, rounded down, but a small order still gets one.
    kit: { qtyPer: 1, perUnits: 12, rounding: 'FLOOR' as const, minQty: 1 },
  },
  {
    code: 'CP200-BATTERY-SPARE',
    description: 'Motorola CP200 Spare Battery',
    qty: numArg('--battery-qty'),
    cost: numArg('--battery-cost'),
    // 50% spares, rounded up — 15 radios get 8.
    kit: { qtyPer: 0.5, perUnits: 1, rounding: 'CEIL' as const, minQty: 0 },
  },
]

async function main() {
  const radios = await prisma.inventoryItem.findMany({
    where: { code: { in: RADIO_CODES } },
    select: { id: true, code: true, description: true },
  })
  const missing = RADIO_CODES.filter((c) => !radios.some((r) => r.code === c))
  if (missing.length > 0) {
    throw new Error(`radio codes not found in the catalog: ${missing.join(', ')}`)
  }

  console.log(`${WRITE ? 'WRITE' : 'DRY RUN'} — walkie kit\n`)
  console.log('Parents:')
  for (const r of radios) console.log(`  ${r.code}  ${r.description}`)
  console.log()

  for (const piece of PIECES) {
    const existing = await prisma.inventoryItem.findUnique({
      where: { code: piece.code },
      select: { id: true, qtyOwned: true },
    })

    if (!existing && piece.qty == null) {
      throw new Error(
        `${piece.code} does not exist yet and no quantity was given — ` +
          `re-run with the count on hand (see --bank-qty / --battery-qty). ` +
          `Inventing a number here would put a fiction in the catalog.`,
      )
    }

    console.log(
      `${existing ? 'exists' : 'CREATE'}  ${piece.code}  ${piece.description}` +
        (piece.qty != null ? `  qty ${piece.qty}` : ''),
    )
    console.log(
      `        kit: ${piece.kit.qtyPer} per ${piece.kit.perUnits}, ` +
        `${piece.kit.rounding === 'FLOOR' ? 'down' : 'up'}, min ${piece.kit.minQty}, free`,
    )

    if (!WRITE) continue

    const data: Prisma.InventoryItemCreateInput = {
      code: piece.code,
      description: piece.description,
      department: 'COMMUNICATIONS',
      type: 'EQUIPMENT',
      // Free by policy, and includedFree keeps a $0 rate from reading as
      // a missing price on the public form.
      dailyRate: 0,
      weeklyRate: 0,
      includedFree: true,
      qtyOwned: piece.qty ?? 0,
      ...(piece.cost != null ? { replacementCost: piece.cost } : {}),
    }
    const item = existing
      ? await prisma.inventoryItem.update({
          where: { id: existing.id },
          data: {
            ...(piece.qty != null ? { qtyOwned: piece.qty } : {}),
            ...(piece.cost != null ? { replacementCost: piece.cost } : {}),
          },
          select: { id: true },
        })
      : await prisma.inventoryItem.create({ data, select: { id: true } })

    for (const radio of radios) {
      await prisma.inventoryKitPiece.upsert({
        where: {
          parentItemId_pieceItemId: { parentItemId: radio.id, pieceItemId: item.id },
        },
        create: {
          parentItemId: radio.id,
          pieceItemId: item.id,
          qtyPer: piece.kit.qtyPer,
          perUnits: piece.kit.perUnits,
          rounding: piece.kit.rounding,
          minQty: piece.kit.minQty,
          billing: 'FREE',
        },
        update: {
          qtyPer: piece.kit.qtyPer,
          perUnits: piece.kit.perUnits,
          rounding: piece.kit.rounding,
          minQty: piece.kit.minQty,
        },
      })
      console.log(`        → attached to ${radio.code}`)
    }
  }

  console.log(
    WRITE
      ? '\nDone. Quotes with radios now auto-add linked accessory lines.'
      : '\nDry run — nothing written. Re-run with --write once the counts are right.',
  )
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
