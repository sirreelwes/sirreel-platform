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
 * These are KIT PIECES — an antenna and a battery per radio BODY.
 *
 * BATTERIES ARE ONE POOL (Wes, 2026-09-11): "we have radio body attached
 * with a battery, along with the antennas for each radio body.
 * Additionally, we include extra batteries. We call the additional
 * batteries beyond the radio body count: spare batteries. In reality
 * every battery is the same and none have a price associated with them,
 * other than a replacement cost. We need to make sure that the pickers
 * count correctly each direction."
 *
 * So the battery is ONE catalog row at 1.5 per radio — one in each body
 * plus a spare per two — NOT a 1:1 row beside the old 0.5 "spare" row.
 * Two rows for one physical object is what makes a return uncountable:
 * 15 radios send 23 batteries, and the 23 that come back are just
 * batteries. Nobody can say which pile a given cell belongs to, so the
 * sheet must not ask. The line's note carries the split (15 in the
 * bodies, 8 loose) so the picker knows where to look for them.
 *
 * A legacy 0.5-ratio spare row (CP200-BATTERY, from
 * seed-walkie-kit-pieces.ts) is DEACTIVATED here on the radios this
 * script touches, and its aliases move onto the surviving row. Its own
 * item is left alone — archiving a catalog row with order history is
 * not this script's business, and it is reported instead.
 *
 * Deliberately NOT client-visible and FREE: no battery or antenna has a
 * price, only a replacement cost, and a quote that suddenly grew two
 * lines per radio reads as a pricing change. The pick list sees them
 * either way — membership follows the line's department, not its
 * visibility.
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

/** The HQ-invented spare row this script folds into the battery pool. */
const LEGACY_SPARE_CODE = 'CP200-BATTERY'

const PARTS = [
  {
    code: '102933',
    description: 'CP200 - Antenna',
    aliases: ['antenna', 'walkie antenna', 'radio antenna'],
    qty: numArg('--antenna-qty'),
    // qtyPer / perUnits / rounding: one antenna per radio body.
    kit: { qtyPer: 1, perUnits: 1, rounding: 'CEIL' as const, minQty: 0 },
    note: 'One per radio — on the body. Count one per radio both ways.',
  },
  {
    code: '102930',
    description: 'CP200 - Battery',
    // Every battery is the same cell, so the spare wording lives here as
    // an alias rather than on a second row.
    aliases: ['walkie battery', 'radio battery', 'spare battery', 'spare batteries', 'battery'],
    qty: numArg('--battery-qty'),
    // 1 in each body + 1 spare per 2 radios, rounded up: 15 → 23.
    kit: { qtyPer: 1.5, perUnits: 1, rounding: 'CEIL' as const, minQty: 0 },
    note: 'Every battery is the same — one in each radio, plus a spare per two. Count them ALL, in the radios and loose, both directions.',
  },
]

const created = {
  items: [] as Array<{ id: string; code: string }>,
  kitPieces: [] as Array<{ id: string; parentCode: string; pieceCode: string }>,
}
/** Legacy spare-battery kit links this run switched off — reversible by id. */
const deactivated: Array<{ id: string; parentCode: string; pieceCode: string }> = []

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
      const per = part.kit.qtyPer === 1 ? '1 per radio' : `${part.kit.qtyPer} per radio (15 → ${Math.ceil(15 * part.kit.qtyPer)})`
      console.log(`    ${radio.code} → ${part.code}  ${per}`)
      if (!WRITE || !item) continue
      const existing = await prisma.inventoryKitPiece.findUnique({
        where: { parentItemId_pieceItemId: { parentItemId: radio.id, pieceItemId: item.id } },
        select: { id: true },
      })
      const data = {
        ...part.kit,
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

  // ── Fold the legacy 0.5 "spare battery" row into the one pool ───────
  // Left alone, 15 radios would put TWO battery lines on the sheet (15
  // and 8) for one physical object, and the checker would have to decide
  // which pile each returned cell came from. There is no such fact.
  const legacy = await prisma.inventoryItem.findUnique({
    where: { code: LEGACY_SPARE_CODE },
    select: { id: true, code: true, description: true, aliases: true },
  })
  if (legacy) {
    const links = await prisma.inventoryKitPiece.findMany({
      where: { pieceItemId: legacy.id, parentItemId: { in: radios.map((r) => r.id) }, isActive: true },
      select: { id: true, parentItemId: true },
    })
    console.log(`Legacy spare row ${legacy.code} — ${legacy.description}`)
    if (!links.length) {
      console.log('  · no active kit links on these radios; nothing to fold\n')
    } else {
      for (const link of links) {
        const parent = radios.find((r) => r.id === link.parentItemId)
        console.log(`  − deactivate ${parent?.code ?? link.parentItemId} → ${legacy.code} (now covered by 102930 at 1.5)`)
        if (WRITE) {
          await prisma.inventoryKitPiece.update({ where: { id: link.id }, data: { isActive: false } })
          await prisma.auditLog.create({
            data: {
              userId: null,
              action: 'inventory.kit_piece_folded',
              entityType: 'InventoryKitPiece',
              entityId: link.id,
              oldValues: { isActive: true, pieceCode: legacy.code },
              newValues: {
                isActive: false,
                reason: 'batteries are one pool — 102930 now carries 1.5 per radio',
                script: 'scripts/seed-radio-parts-kit.ts',
              },
            },
          })
          deactivated.push({ id: link.id, parentCode: parent?.code ?? '?', pieceCode: legacy.code })
        }
      }
      console.log(
        `  The ${legacy.code} ITEM is left as it is — it has order history, and archiving a catalog\n` +
          '  row is not this script\'s call. It simply stops being added to new radio orders.\n',
      )
    }
  }

  if (WRITE && (created.items.length || created.kitPieces.length || deactivated.length)) {
    mkdirSync('journals', { recursive: true })
    const file = path.join('journals', `radio-parts-kit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, JSON.stringify({ ...created, deactivated }, null, 2))
    console.log(`journal: ${file}`)
  }
  if (!WRITE) console.log('Dry run — add --write to apply.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1) })
