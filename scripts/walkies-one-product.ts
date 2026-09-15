/**
 * Walkies become one product — the data half.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/walkies-one-product.ts            # dry run, prints every change
 *   npx tsx scripts/walkies-one-product.ts --write
 *   npx tsx scripts/seed-catalog-aliases.ts --apply   # then: the aliases (seed-owned)
 *
 * Wes, 2026-09-15: "remove from the order form anything that indicates
 * whether they are digital, analog, or sub … From the client side, it
 * should only look like the Motorola CP200. Also, we should remove sub from
 * the inventory." The code half is src/lib/catalog/walkies.ts; this puts
 * the catalog and the open orders into the shape that code expects:
 *
 *   1. the digital row (104387) — the orderable one — is renamed
 *      "Motorola CP200";
 *   2. the analog row (103733) stops being published (it is stock-only;
 *      the code already hides it everywhere, this makes the flag agree);
 *   3. the sub row (CP200S) is archived — zero on hand, zero references;
 *   4. every walkie line bound to the analog row is rebound to the digital
 *      row, and its auto-added kit lines (charger, batteries) are re-keyed
 *      to the digital row's matching kit pieces so the reconciler keeps
 *      them instead of deleting and re-adding;
 *   5. every order line whose description or note names a radio type
 *      ("Motorola CP200  UHF Radio (Analog)", "Included with 12 × … (Digital)")
 *      is rewritten to say Motorola CP200.
 *
 * Lines on INVOICED / CLOSED orders are left exactly as billed — reported,
 * never touched. None existed when this was written.
 *
 * NOT touched, on purpose: the RentalWorks unit register (545 rows, synced
 * nightly — it is RW's description, and the warehouse's truth), filed
 * check-report sheets (a record of what was signed), and inquiry text (the
 * client's own words).
 *
 * --write journals every row it changed with its BEFORE values to
 * journals/walkies-one-product-*.json, plus one AuditLog row. Undo restores
 * exactly those ids from the journal — never by shape.
 */

import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'
import {
  RETIRED_WALKIE_CODES,
  STOCK_ONLY_CODES,
  WALKIE_NAME,
  WALKIE_ORDER_CODE,
  walkieClientName,
} from '../src/lib/catalog/walkies'

const WRITE = process.argv.includes('--write')
const FROZEN = new Set(['INVOICED', 'CLOSED'])

interface Journal {
  ranAt: string
  items: Array<{ id: string; code: string; before: Record<string, unknown>; after: Record<string, unknown> }>
  lines: Array<{ id: string; orderNumber: string; before: Record<string, unknown>; after: Record<string, unknown> }>
  skippedFrozen: Array<{ id: string; orderNumber: string; status: string }>
}

async function main() {
  const journal: Journal = { ranAt: new Date().toISOString(), items: [], lines: [], skippedFrozen: [] }
  console.log(`${WRITE ? 'WRITE' : 'DRY RUN'} — walkies become one product\n`)

  const order = await prisma.inventoryItem.findUnique({
    where: { code: WALKIE_ORDER_CODE },
    select: { id: true, code: true, description: true, isActive: true },
  })
  if (!order || !order.isActive) throw new Error(`orderable walkie row ${WALKIE_ORDER_CODE} missing or archived`)
  const stock = await prisma.inventoryItem.findMany({
    where: { code: { in: [...STOCK_ONLY_CODES] } },
    select: { id: true, code: true, description: true, publicVisible: true },
  })
  if (stock.length !== STOCK_ONLY_CODES.length) throw new Error('a stock-only walkie row is missing')
  const retired = await prisma.inventoryItem.findMany({
    where: { code: { in: [...RETIRED_WALKIE_CODES] } },
    select: {
      id: true, code: true, description: true, isActive: true, archivedAt: true, publicVisible: true,
      _count: { select: { lineItems: true, packageItems: true, kitPieces: true, kitPieceOf: true } },
    },
  })

  // 1. Rename the orderable row.
  if (order.description !== WALKIE_NAME) {
    console.log(`rename   ${order.code}  "${order.description}" → "${WALKIE_NAME}"`)
    journal.items.push({ id: order.id, code: order.code, before: { description: order.description }, after: { description: WALKIE_NAME } })
  }

  // 2. Unpublish the stock-only rows.
  for (const s of stock) {
    if (s.publicVisible) {
      console.log(`hide     ${s.code}  "${s.description}" (stock-only)`)
      journal.items.push({ id: s.id, code: s.code, before: { publicVisible: true }, after: { publicVisible: false } })
    }
  }

  // 3. Archive the sub row — only if nothing points at it.
  const archivedAt = new Date()
  for (const r of retired) {
    const refs = r._count.lineItems + r._count.packageItems + r._count.kitPieces + r._count.kitPieceOf
    if (!r.isActive) { console.log(`ok       ${r.code} already archived`); continue }
    if (refs > 0) {
      console.log(`REFUSE   ${r.code}  "${r.description}" — ${refs} reference(s); archive by hand after looking`)
      continue
    }
    console.log(`archive  ${r.code}  "${r.description}" (0 references)`)
    journal.items.push({
      id: r.id, code: r.code,
      before: { isActive: r.isActive, archivedAt: r.archivedAt, publicVisible: r.publicVisible },
      after: { isActive: false, archivedAt: archivedAt.toISOString(), publicVisible: false },
    })
  }

  // 4 + 5. Lines. Kit pieces of the stock rows map to the orderable row's
  // piece for the same accessory.
  const kits = await prisma.inventoryKitPiece.findMany({
    where: { parentItemId: { in: [order.id, ...stock.map((s) => s.id)] } },
    select: { id: true, parentItemId: true, pieceItemId: true },
  })
  const orderKitByPiece = new Map(kits.filter((k) => k.parentItemId === order.id).map((k) => [k.pieceItemId, k.id]))
  const kitRemap = new Map<string, string>()
  for (const k of kits) {
    if (k.parentItemId === order.id) continue
    const target = orderKitByPiece.get(k.pieceItemId)
    if (target) kitRemap.set(k.id, target)
    else console.log(`WARN     kit piece ${k.id} on a stock row has no counterpart on ${WALKIE_ORDER_CODE} — its lines keep it`)
  }

  const stockIds = stock.map((s) => s.id)
  const lines = await prisma.orderLineItem.findMany({
    where: {
      OR: [
        { inventoryItemId: { in: stockIds } },
        { autoKitPieceId: { in: [...kitRemap.keys()] } },
        { description: { contains: 'cp200', mode: 'insensitive' } },
        { notes: { contains: 'cp200', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, description: true, notes: true, inventoryItemId: true, autoKitPieceId: true,
      order: { select: { orderNumber: true, status: true } },
    },
  })

  for (const l of lines) {
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (l.inventoryItemId && stockIds.includes(l.inventoryItemId)) {
      before.inventoryItemId = l.inventoryItemId; after.inventoryItemId = order.id
    }
    if (l.autoKitPieceId && kitRemap.has(l.autoKitPieceId)) {
      before.autoKitPieceId = l.autoKitPieceId; after.autoKitPieceId = kitRemap.get(l.autoKitPieceId)
    }
    const desc = walkieClientName(l.description)
    if (desc !== l.description) { before.description = l.description; after.description = desc }
    const notes = walkieClientName(l.notes)
    if (notes !== l.notes) { before.notes = l.notes; after.notes = notes }
    if (Object.keys(after).length === 0) continue

    if (FROZEN.has(l.order.status)) {
      console.log(`frozen   ${l.order.orderNumber} (${l.order.status}) line ${l.id} — left as billed`)
      journal.skippedFrozen.push({ id: l.id, orderNumber: l.order.orderNumber, status: l.order.status })
      continue
    }
    console.log(`line     ${l.order.orderNumber} (${l.order.status}) ${Object.keys(after).join(', ')}` +
      (after.description ? `  "${before.description}" → "${after.description}"` : ''))
    journal.lines.push({ id: l.id, orderNumber: l.order.orderNumber, before, after })
  }

  console.log(`\n${journal.items.length} catalog row(s), ${journal.lines.length} line(s), ${journal.skippedFrozen.length} frozen`)
  if (!WRITE) {
    console.log('Dry run — nothing written. Re-run with --write.')
    return
  }
  if (journal.items.length === 0 && journal.lines.length === 0) {
    console.log('Nothing to do.')
    return
  }

  // Journal BEFORE writing, so a failure mid-way still leaves the undo map.
  mkdirSync(path.join(process.cwd(), 'journals'), { recursive: true })
  const stamp = journal.ranAt.replace(/[:.]/g, '-')
  const file = path.join(process.cwd(), 'journals', `walkies-one-product-${stamp}.json`)
  writeFileSync(file, JSON.stringify(journal, null, 2))
  console.log(`Journal: ${file}`)

  await prisma.$transaction(async (tx) => {
    for (const it of journal.items) {
      const a = it.after
      await tx.inventoryItem.update({
        where: { id: it.id },
        data: {
          ...(a.description !== undefined ? { description: a.description as string } : {}),
          ...(a.publicVisible !== undefined ? { publicVisible: a.publicVisible as boolean } : {}),
          ...(a.isActive !== undefined ? { isActive: a.isActive as boolean, archivedAt } : {}),
        },
      })
    }
    for (const ln of journal.lines) {
      const a = ln.after
      await tx.orderLineItem.update({
        where: { id: ln.id },
        data: {
          ...(a.inventoryItemId !== undefined ? { inventoryItemId: a.inventoryItemId as string } : {}),
          ...(a.autoKitPieceId !== undefined ? { autoKitPieceId: a.autoKitPieceId as string } : {}),
          ...(a.description !== undefined ? { description: a.description as string } : {}),
          ...(a.notes !== undefined ? { notes: a.notes as string | null } : {}),
        },
      })
    }
    await tx.auditLog.create({
      data: {
        action: 'catalog.walkies_one_product',
        entityType: 'inventory_item',
        entityId: order.id,
        newValues: {
          journal: path.basename(file),
          itemIds: journal.items.map((i) => i.id),
          lineIds: journal.lines.map((l) => l.id),
        },
      },
    })
  }, { timeout: 60_000 })

  console.log('Written. Next: npx tsx scripts/seed-catalog-aliases.ts --apply')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
