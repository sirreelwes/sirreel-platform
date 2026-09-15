/**
 * The walkie kit stops printing for clients.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/walkie-kit-client-hidden.ts          # dry run
 *   npx tsx scripts/walkie-kit-client-hidden.ts --write
 *
 * Wes, 2026-09-15: "from client side — only Motorola CP200." The free CP200
 * Battery and 6-Bank Charger lines were printing on client quotes, the
 * portal and invoices. src/lib/orders/clientLines.ts now honours
 * `InventoryKitPiece.clientVisible`; this sets it false on every active kit
 * piece hanging off the walkie rows, and touches those lines' `updatedAt`
 * on live orders so their stored quote PDFs count as stale and re-cut
 * without them (lib/orders/quotePdfFreshness.ts). Nothing about the lines
 * changes — the warehouse still pulls and counts them.
 *
 * --write journals every kit-piece id with its prior value to
 * journals/walkie-kit-client-hidden-*.json plus one AuditLog row.
 */

import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'
import { WALKIE_FAMILY_CODES } from '../src/lib/catalog/walkies'

const WRITE = process.argv.includes('--write')
const LIVE = ['DRAFT', 'QUOTE_SENT', 'APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK'] as const

async function main() {
  const kits = await prisma.inventoryKitPiece.findMany({
    where: { parent: { code: { in: [...WALKIE_FAMILY_CODES] } } },
    select: {
      id: true, clientVisible: true, billing: true, isActive: true,
      parent: { select: { code: true } }, piece: { select: { code: true, description: true } },
    },
  })
  const toHide = kits.filter((k) => k.clientVisible)
  for (const k of kits) {
    console.log(`${k.clientVisible ? 'hide ' : 'ok   '} ${k.parent.code} → ${k.piece.code} (${k.billing}${k.isActive ? '' : ', inactive'})`)
    if (k.billing === 'CHARGED') console.log('       CHARGED — prints regardless (clientLines.ts only hides $0 lines)')
  }
  const lines = await prisma.orderLineItem.findMany({
    where: { autoKitPieceId: { in: kits.map((k) => k.id) }, order: { status: { in: [...LIVE] } } },
    select: { id: true, order: { select: { orderNumber: true } } },
  })
  console.log(`\n${toHide.length} kit piece(s) to hide; ${lines.length} line(s) on live orders to touch (${[...new Set(lines.map((l) => l.order.orderNumber))].join(', ')})`)
  if (!WRITE) { console.log('Dry run — nothing written.'); return }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  mkdirSync(path.join(process.cwd(), 'journals'), { recursive: true })
  const file = path.join(process.cwd(), 'journals', `walkie-kit-client-hidden-${stamp}.json`)
  writeFileSync(file, JSON.stringify({
    ranAt: stamp,
    kitPieces: toHide.map((k) => ({ id: k.id, before: { clientVisible: true }, after: { clientVisible: false } })),
    touchedLineIds: lines.map((l) => l.id),
  }, null, 2))
  console.log(`Journal: ${file}`)

  await prisma.$transaction(async (tx) => {
    if (toHide.length) {
      await tx.inventoryKitPiece.updateMany({ where: { id: { in: toHide.map((k) => k.id) } }, data: { clientVisible: false } })
    }
    if (lines.length) {
      await tx.orderLineItem.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { updatedAt: new Date() } })
    }
    await tx.auditLog.create({
      data: {
        action: 'catalog.walkie_kit_client_hidden',
        entityType: 'inventory_kit_piece',
        entityId: toHide[0]?.id ?? kits[0]?.id ?? 'none',
        newValues: { journal: path.basename(file), kitPieceIds: toHide.map((k) => k.id), touchedLineIds: lines.map((l) => l.id) },
      },
    })
  })
  console.log('Written.')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
