/**
 * Reclassify furniture + dolly gear into Pro Supplies.
 *
 * Wes, 2026-09-04: "we need to reclassify furniture, dolly to pro
 * supplies" — department AND category, for every furniture/dolly row in
 * the catalog, not just the ones that are obviously misfiled.
 *
 * Why both axes: category OWNS the department for anything created from
 * here on (InventoryCategory.department, 2026-08-28), so moving only the
 * department leaves the next hand truck someone adds under Grip Equipment
 * to inherit GE all over again. Moving only the category leaves the
 * existing rows billing on the G&E rule. This does both, plus the two
 * target categories themselves.
 *
 * ── What it touches ────────────────────────────────────────────────
 *
 *   dollies  → category `dollies-carts`, department PRO_SUPPLIES
 *              magliner / handtruck / appliance / furniture dollies,
 *              doorway + western + Dana camera dollies, dolly track,
 *              pallet jacks.
 *   furniture→ category `basecamp-basics`, department PRO_SUPPLIES
 *              furniture pads, furniture clamps.
 *
 * Racks are NOT dollies. "Dolly Track Rack, Single" and "DollyTrack
 * Racks (Each)" are truck-mounted transport hardware that lives in
 * Vehicle Outfitting — same carve-out the public form already makes for
 * a Director's Chair Rack (src/lib/site/publicSupplySections.ts). They
 * are listed in the preflight under SKIPPED so the decision is visible
 * rather than silent.
 *
 * ── Billing changes for anything moving off GE ─────────────────────
 *
 * BILLING_RULES (src/lib/orders/billing.ts): GE bills 7 days per 7-day
 * window, PRO_SUPPLIES bills 3. A weekly rental of a moved item bills
 * LESS after this runs. That is the point of the reclassification, but
 * it is a price change — the preflight prints every such row under
 * "REPRICES ON WEEKLY RENTALS" so it can be vetoed before --apply.
 *
 * To veto specific rows, add their `code` to EXCLUDE_CODES below and
 * re-run. Nothing else needs editing.
 *
 * ── What it does NOT touch ─────────────────────────────────────────
 *
 * Existing OrderLineItems. `OrderLineItem.department` and `.rate` are
 * snapshotted at line create precisely so a catalog edit can't reprice
 * work that is already quoted, booked or invoiced. Open orders that
 * carry a moved item are REPORTED (count + order numbers) so a rep can
 * re-add a line if they want the new department on a live quote; this
 * script never rewrites one.
 *
 * Archived items (isActive=false) are left alone and counted.
 *
 * ── Reversal ───────────────────────────────────────────────────────
 *
 * Every write captures the row id with its BEFORE values, journalled to
 * tmp/reclassify-furniture-dolly-<ts>.json and mirrored into AuditLog
 * (action `inventory.reclassify_furniture_dolly`). Undo = restore
 * department/categoryId BY THOSE IDS. Never delete or update by pattern.
 *
 * Idempotent: a second run finds nothing to move.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/reclassify-furniture-dolly-pro-supplies.ts           # preflight
 *   npx tsx scripts/reclassify-furniture-dolly-pro-supplies.ts --apply   # write
 */

import { writeFileSync, mkdirSync } from 'fs'
import { prisma } from '../src/lib/prisma'
import type { LineItemDepartment } from '@prisma/client'
// ONE definition of what "furniture and dollies" covers, shared with the
// test that holds it to the real catalog names.
import {
  FURNITURE_DOLLY_CLUSTERS as CLUSTERS,
  classifyFurnitureDolly,
} from '../src/lib/inventory/furnitureDollyClass'

const APPLY = process.argv.includes('--apply')

const TARGET_DEPT: LineItemDepartment = 'PRO_SUPPLIES'
const OPERATOR_EMAIL = 'wes@sirreel.com'
const AUDIT_ACTION = 'inventory.reclassify_furniture_dolly'

/** Item `code`s to leave exactly where they are. Empty = move everything
 *  the clusters match. Add a code here to veto one row without touching
 *  the match rules. */
const EXCLUDE_CODES: string[] = []

/** Categories that must themselves bill as Pro Supplies so new items
 *  inherit it (InventoryCategory owns the department on create). */
const TARGET_CATEGORY_SLUGS = [...new Set(CLUSTERS.map((c) => c.categorySlug))]

type Move = {
  id: string
  code: string
  name: string
  cluster: string
  fromDept: LineItemDepartment
  fromCategory: string
  fromCategoryId: string | null
  toCategoryId: string
  toCategory: string
}

async function main() {
  console.log(APPLY ? '=== APPLYING ===' : '=== PREFLIGHT (pass --apply to write) ===\n')

  const operator = await prisma.user.findFirst({
    where: { email: OPERATOR_EMAIL },
    select: { id: true },
  })
  if (!operator) throw new Error(`No User row for ${OPERATOR_EMAIL} — refusing to write unattributed rows`)

  const cats = await prisma.inventoryCategory.findMany({
    select: { id: true, name: true, slug: true, department: true },
  })
  const catBySlug = new Map(cats.map((c) => [c.slug, c]))
  for (const slug of TARGET_CATEGORY_SLUGS) {
    if (!catBySlug.has(slug)) throw new Error(`Target InventoryCategory slug missing: ${slug}`)
  }

  const items = await prisma.inventoryItem.findMany({
    select: {
      id: true, code: true, description: true, department: true,
      categoryId: true, isActive: true,
      category: { select: { name: true, slug: true } },
    },
    orderBy: { code: 'asc' },
  })

  const moves: Move[] = []
  const skipped: { why: string; name: string; where: string }[] = []
  const alreadyRight: string[] = []

  for (const it of items) {
    const name = it.description ?? it.code
    const verdict = classifyFurnitureDolly(name, it.code)
    if (!verdict) continue

    const where = `${it.category?.name ?? 'no category'} / ${it.department}`
    if (verdict.kind === 'skip') { skipped.push({ why: verdict.reason, name, where }); continue }
    if (EXCLUDE_CODES.includes(it.code)) { skipped.push({ why: 'vetoed in EXCLUDE_CODES', name, where }); continue }
    if (!it.isActive) { skipped.push({ why: 'archived', name, where }); continue }

    const cluster = verdict.cluster
    const target = catBySlug.get(cluster.categorySlug)!
    if (it.department === TARGET_DEPT && it.categoryId === target.id) { alreadyRight.push(name); continue }

    moves.push({
      id: it.id,
      code: it.code,
      name,
      cluster: cluster.key,
      fromDept: it.department,
      fromCategory: it.category?.name ?? '—',
      fromCategoryId: it.categoryId,
      toCategoryId: target.id,
      toCategory: target.name,
    })
  }

  // ── Report ────────────────────────────────────────────────────────
  const catFixes = TARGET_CATEGORY_SLUGS
    .map((slug) => catBySlug.get(slug)!)
    .filter((c) => c.department !== TARGET_DEPT)

  for (const c of CLUSTERS) {
    const mine = moves.filter((m) => m.cluster === c.key)
    console.log(`[${c.key}] → ${c.categorySlug} / ${TARGET_DEPT}  (${c.note})`)
    if (mine.length === 0) console.log('   nothing to move')
    for (const m of mine) {
      console.log(`   ${m.name.slice(0, 44).padEnd(44)} ${m.fromCategory} / ${m.fromDept}  →  ${m.toCategory} / ${TARGET_DEPT}`)
    }
    console.log()
  }

  const reprices = moves.filter((m) => m.fromDept !== TARGET_DEPT)
  if (reprices.length > 0) {
    console.log(`REPRICES ON WEEKLY RENTALS — ${reprices.length} row(s) leave a 7-day-per-week`)
    console.log('billing rule for the 3-day Pro Supplies rule (src/lib/orders/billing.ts):')
    for (const m of reprices) console.log(`   ${m.fromDept} → ${TARGET_DEPT}   ${m.name}   [${m.code}]`)
    console.log('   Veto any of these by adding its [code] to EXCLUDE_CODES.\n')
  }

  if (catFixes.length > 0) {
    console.log('CATEGORY DEFAULTS to fix (so new items inherit Pro Supplies):')
    for (const c of catFixes) console.log(`   ${c.name} (${c.slug})  ${c.department} → ${TARGET_DEPT}`)
    console.log()
  }

  if (skipped.length > 0) {
    console.log('SKIPPED:')
    for (const s of skipped) console.log(`   ${s.name.slice(0, 44).padEnd(44)} ${s.where}   — ${s.why}`)
    console.log()
  }
  console.log(`Already correct (no-op): ${alreadyRight.length}`)
  console.log(`To move: ${moves.length} item(s)${catFixes.length ? ` + ${catFixes.length} category default(s)` : ''}\n`)

  // Live orders carrying a moved item — reported, never rewritten.
  if (moves.length > 0) {
    const openLines = await prisma.orderLineItem.findMany({
      where: {
        inventoryItemId: { in: moves.map((m) => m.id) },
        order: { status: { in: ['DRAFT', 'QUOTE_SENT', 'APPROVED', 'BOOKED'] } },
      },
      select: { description: true, order: { select: { orderNumber: true, status: true } } },
    })
    if (openLines.length > 0) {
      const byOrder = new Map<string, string>()
      for (const l of openLines) byOrder.set(l.order.orderNumber, l.order.status)
      console.log(`NOT TOUCHED — ${openLines.length} line item(s) on ${byOrder.size} open order(s) carry a moved item.`)
      console.log('Their department + rate were snapshotted at line create and stay as quoted:')
      for (const [num, status] of byOrder) console.log(`   ${num}  ${status}`)
      console.log('   Re-add the line on an order if you want it to pick up the new department.\n')
    }
  }

  if (!APPLY) {
    console.log('Preflight complete. Re-run with --apply to write.')
    return
  }
  if (moves.length === 0 && catFixes.length === 0) {
    console.log('Nothing to do.')
    return
  }

  // ── Apply ─────────────────────────────────────────────────────────
  mkdirSync('tmp', { recursive: true })
  const journalPath = `tmp/reclassify-furniture-dolly-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(journalPath, JSON.stringify({
    appliedAt: new Date().toISOString(),
    itemIds: moves.map((m) => m.id),
    items: moves,
    categories: catFixes.map((c) => ({ id: c.id, slug: c.slug, fromDept: c.department, toDept: TARGET_DEPT })),
  }, null, 2))

  // By captured id only — never by pattern (SHIPLOG "Hard Rules").
  for (const m of moves) {
    await prisma.inventoryItem.update({
      where: { id: m.id },
      data: { department: TARGET_DEPT, categoryId: m.toCategoryId },
    })
  }
  for (const c of catFixes) {
    await prisma.inventoryCategory.update({ where: { id: c.id }, data: { department: TARGET_DEPT } })
  }

  await prisma.auditLog.createMany({
    data: [
      ...moves.map((m) => ({
        action: AUDIT_ACTION,
        entityType: 'InventoryItem',
        entityId: m.id,
        userId: operator.id,
        oldValues: { department: m.fromDept, categoryId: m.fromCategoryId, category: m.fromCategory },
        newValues: { department: TARGET_DEPT, categoryId: m.toCategoryId, category: m.toCategory },
      })),
      ...catFixes.map((c) => ({
        action: AUDIT_ACTION,
        entityType: 'InventoryCategory',
        entityId: c.id,
        userId: operator.id,
        oldValues: { department: c.department },
        newValues: { department: TARGET_DEPT },
      })),
    ],
  }).catch((err) => console.error('[audit] write failed (the moves stand):', err))

  console.log(`Moved ${moves.length} item(s); fixed ${catFixes.length} category default(s).`)
  console.log(`Reversal journal: ${journalPath} — restore department/categoryId BY THOSE IDS to undo.`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
