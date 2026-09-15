/**
 * "Includes batteries and chargers" under every Motorola CP200.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/walkie-client-note.ts          # dry run
 *   npx tsx scripts/walkie-client-note.ts --write
 *
 * Wes, 2026-09-15. The battery and charger lines no longer print for the
 * client (lib/orders/clientLines.ts), so the radio says what comes with it.
 * One small italic line on the quote PDF — checked rendered before shipping.
 *
 * Sets `InventoryItem.clientNote` on the orderable walkie row, which every
 * line-add path already seeds into `OrderLineItem.notes` for new lines.
 * Backfills the same text onto existing walkie lines on live orders whose
 * notes are EMPTY — a note a rep wrote is never overwritten. Touching the
 * line bumps its updatedAt, so stored quote PDFs re-cut with the note.
 *
 * --write journals every id with its prior value to
 * journals/walkie-client-note-*.json plus one AuditLog row.
 */

import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'
import { WALKIE_ORDER_CODE } from '../src/lib/catalog/walkies'

const WRITE = process.argv.includes('--write')
const NOTE = 'Includes batteries and chargers'
const LIVE = ['DRAFT', 'QUOTE_SENT', 'APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK'] as const

async function main() {
  const item = await prisma.inventoryItem.findUnique({
    where: { code: WALKIE_ORDER_CODE },
    select: { id: true, description: true, clientNote: true },
  })
  if (!item) throw new Error(`walkie row ${WALKIE_ORDER_CODE} not found`)
  console.log(`item   ${item.description}: clientNote ${JSON.stringify(item.clientNote)} → ${JSON.stringify(NOTE)}`)

  const lines = await prisma.orderLineItem.findMany({
    where: {
      inventoryItemId: item.id,
      autoKitPieceId: null,
      order: { status: { in: [...LIVE] } },
    },
    select: { id: true, notes: true, order: { select: { orderNumber: true, status: true } } },
  })
  const toFill = lines.filter((l) => !l.notes || !l.notes.trim())
  for (const l of lines) {
    console.log(`${toFill.includes(l) ? 'fill ' : 'keep '} ${l.order.orderNumber} (${l.order.status})${toFill.includes(l) ? '' : ` — has a note: ${JSON.stringify(l.notes)}`}`)
  }
  console.log(`\n${toFill.length} line(s) to fill`)
  if (!WRITE) { console.log('Dry run — nothing written.'); return }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  mkdirSync(path.join(process.cwd(), 'journals'), { recursive: true })
  const file = path.join(process.cwd(), 'journals', `walkie-client-note-${stamp}.json`)
  writeFileSync(file, JSON.stringify({
    ranAt: stamp,
    item: { id: item.id, before: { clientNote: item.clientNote }, after: { clientNote: NOTE } },
    lines: toFill.map((l) => ({ id: l.id, before: { notes: l.notes }, after: { notes: NOTE } })),
  }, null, 2))
  console.log(`Journal: ${file}`)

  await prisma.$transaction(async (tx) => {
    await tx.inventoryItem.update({ where: { id: item.id }, data: { clientNote: NOTE } })
    if (toFill.length) {
      await tx.orderLineItem.updateMany({ where: { id: { in: toFill.map((l) => l.id) } }, data: { notes: NOTE } })
    }
    await tx.auditLog.create({
      data: {
        action: 'catalog.walkie_client_note',
        entityType: 'inventory_item',
        entityId: item.id,
        newValues: { journal: path.basename(file), note: NOTE, lineIds: toFill.map((l) => l.id) },
      },
    })
  })
  console.log('Written.')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
