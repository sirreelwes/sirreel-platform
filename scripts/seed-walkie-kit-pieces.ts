/**
 * Attach the walkie kit to the CP200 radios as real included accessories.
 *
 *   npx tsx scripts/seed-walkie-kit-pieces.ts          # dry run
 *   npx tsx scripts/seed-walkie-kit-pieces.ts --write
 *
 * Why this isn't already done: the charging bank and the battery have
 * never existed as catalog rows. The kit shipped as hardcoded text
 * lines (src/lib/sales/walkieKit.ts), so there was nothing to link. This
 * script creates the two rows — quantities and replacement costs are
 * arguments, NOT guesses — and hangs them off all three CP200 rows with
 * Wes's ratios (2026-08-17): batteries at 50% of the radio count, one
 * bank per 12.
 *
 * NAMING (Wes 2026-08-29): the row is "Motorola CP200 Battery", not
 * "Spare Battery". It is the battery the radio takes — "spare" describes
 * the REASON a second one ships, not the part. Crews still ask for a
 * spare battery, so that wording lives on as an alias instead of in the
 * name. Aliases are set here rather than in scripts/seed-catalog-aliases.ts
 * because that script pins its targets by id and this row does not exist
 * yet; once it does, further aliases belong there.
 *
 *   --bank-qty N        units of the 6-bank charger owned
 *   --battery-qty N     batteries owned
 *   --bank-cost N       replacement cost each (optional)
 *   --battery-cost N    replacement cost each (optional)
 *
 * Idempotent: items are matched by `code` and kits by (parent, piece),
 * so a re-run updates rather than duplicates. Nothing is deleted.
 *
 * A --write run journals every id it CREATED to journals/walkie-kit-seed-*.json.
 * That file is the only safe basis for an undo: deleting these rows by
 * shape (say, "every kit piece on a CP200") would take out anything a
 * human configured in the drawer afterwards.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
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

// The radios the kit hangs off. Codes, not names — names drift.
//
// CP200S (the "Sub" radio) is deliberately NOT here. It has zero on hand
// and no replacement cost, which reads as a sub-rental placeholder rather
// than stock we own — and a sub'd radio most likely arrives with the
// partner's own batteries, so auto-adding OURS to that order would send
// gear nobody asked for. Pending Wes's call; `--include-sub` adds it, and
// the script is idempotent so that is a one-line re-run.
const RADIO_CODES = ['103733', '104387']
if (args.includes('--include-sub')) RADIO_CODES.push('CP200S')

const PIECES = [
  {
    code: 'CP200-CHARGER-6BANK',
    description: 'Motorola CP200 6-Bank Charger',
    aliases: ['charging bank', 'charge bank', 'walkie charger', 'radio charger'],
    qty: numArg('--bank-qty'),
    cost: numArg('--bank-cost'),
    // One per 12 radios, rounded down, but a small order still gets one.
    kit: { qtyPer: 1, perUnits: 12, rounding: 'FLOOR' as const, minQty: 1 },
  },
  {
    code: 'CP200-BATTERY',
    description: 'Motorola CP200 Battery',
    // How crews ask for it. Feeds both the AI catalog snippet and the
    // fallback matcher, so "8 spare batteries" on a client's email
    // resolves to this row instead of one of the seventeen unrelated
    // battery rows in the catalog.
    aliases: ['spare battery', 'spare batteries', 'walkie battery', 'radio battery'],
    qty: numArg('--battery-qty'),
    cost: numArg('--battery-cost'),
    // One per two radios, rounded up — 15 radios get 8.
    kit: { qtyPer: 0.5, perUnits: 1, rounding: 'CEIL' as const, minQty: 0 },
  },
]

/** Ids this run brought into existence — never ids it merely updated. */
const created = { items: [] as Array<{ id: string; code: string }>, kitPieces: [] as Array<{ id: string; parentCode: string; pieceCode: string }> }

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
      select: { id: true, qtyOwned: true, aliases: true },
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
      aliases: piece.aliases,
      ...(piece.cost != null ? { replacementCost: piece.cost } : {}),
    }
    const item = existing
      ? await prisma.inventoryItem.update({
          where: { id: existing.id },
          data: {
            ...(piece.qty != null ? { qtyOwned: piece.qty } : {}),
            ...(piece.cost != null ? { replacementCost: piece.cost } : {}),
            // UNION, never replace — same contract as seed-catalog-aliases.ts.
            // A re-run must not drop an alias someone curated by hand.
            aliases: [...new Set([...existing.aliases, ...piece.aliases])],
          },
          select: { id: true },
        })
      : await prisma.inventoryItem.create({ data, select: { id: true } })
    if (!existing) created.items.push({ id: item.id, code: piece.code })

    for (const radio of radios) {
      const priorKit = await prisma.inventoryKitPiece.findUnique({
        where: {
          parentItemId_pieceItemId: { parentItemId: radio.id, pieceItemId: item.id },
        },
        select: { id: true },
      })
      const kitRow = await prisma.inventoryKitPiece.upsert({
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
        select: { id: true },
      })
      if (!priorKit) {
        created.kitPieces.push({ id: kitRow.id, parentCode: radio.code, pieceCode: piece.code })
      }
      console.log(`        → attached to ${radio.code}${priorKit ? ' (updated)' : ''}`)
    }
  }

  if (WRITE && (created.items.length > 0 || created.kitPieces.length > 0)) {
    mkdirSync(path.join(process.cwd(), 'journals'), { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const journal = path.join(process.cwd(), 'journals', `walkie-kit-seed-${stamp}.json`)
    writeFileSync(journal, JSON.stringify({ createdAt: stamp, ...created }, null, 2))
    console.log(`\nJournal: ${journal}`)
    console.log('  Undo deletes ONLY these ids — never by shape.')
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
