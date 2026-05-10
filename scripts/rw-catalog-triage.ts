/**
 * Triage the inventory_items rows that came out of the RW import flagged
 * with needsReview=true. Default = preflight report; --apply does writes.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   export RENTALWORKS_TOKEN=$(grep '^RENTALWORKS_TOKEN' .env.local | cut -d'=' -f2-)
 *   npx tsx scripts/rw-catalog-triage.ts            # preflight
 *   npx tsx scripts/rw-catalog-triage.ts --apply    # apply
 *
 * Triage logic: re-pull the RW catalog and join by rwId so we can read
 * each item's RW.Category. Then map RW.Category → SirReel
 * InventoryCategory + LineItemDepartment via the explicit table below.
 * Items where the mapping is confident clear needsReview=false on apply.
 */

import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'
import { fetchAllItems, groupItemsToMasters } from '../src/lib/rentalworks/client'
import type { LineItemDepartment } from '@prisma/client'

const APPLY = process.argv.includes('--apply')

interface Mapping {
  invCategorySlug: 'electrical-equipment' | 'grip-equipment' | 'lighting-equipment' | 'production-supplies'
  dept: LineItemDepartment
}

// RW.Category → SirReel inventory_categories.slug + LineItemDepartment.
// Coverage is complete for the 20 RW categories present on the 95
// needsReview rows as of 2026-05-09. Add new entries when re-running on
// a future RW catalog state.
const RW_CATEGORY_MAP: Record<string, Mapping> = {
  // Lighting brands → lighting-equipment / GE
  Mole:            { invCategorySlug: 'lighting-equipment',   dept: 'GE' },
  Kino:            { invCategorySlug: 'lighting-equipment',   dept: 'GE' },
  ETC:             { invCategorySlug: 'lighting-equipment',   dept: 'GE' },
  FLUOTEC:         { invCategorySlug: 'lighting-equipment',   dept: 'GE' },
  K5600:           { invCategorySlug: 'lighting-equipment',   dept: 'GE' },
  Arri:            { invCategorySlug: 'lighting-equipment',   dept: 'GE' },
  Astera:          { invCategorySlug: 'lighting-equipment',   dept: 'GE' },
  Barger:          { invCategorySlug: 'lighting-equipment',   dept: 'GE' },
  'Speed Rings':   { invCategorySlug: 'lighting-equipment',   dept: 'GE' },
  // Distro / cable / dimmers
  'Distro & Power': { invCategorySlug: 'electrical-equipment', dept: 'GE' },
  // Grip
  Stands:           { invCategorySlug: 'grip-equipment',       dept: 'GE' },
  Dolly:            { invCategorySlug: 'grip-equipment',       dept: 'GE' },
  'Steel Deck':     { invCategorySlug: 'grip-equipment',       dept: 'GE' },
  // Production-side tooling / consumables / accessories
  'Tents & Access': { invCategorySlug: 'production-supplies',  dept: 'PRO_SUPPLIES' },
  'Tools & Cleaning':{ invCategorySlug: 'production-supplies', dept: 'PRO_SUPPLIES' },
  Effects:          { invCategorySlug: 'production-supplies',  dept: 'PRO_SUPPLIES' },
  HMU:              { invCategorySlug: 'production-supplies',  dept: 'PRO_SUPPLIES' },
  'Safety & Traffic':{ invCategorySlug: 'production-supplies', dept: 'PRO_SUPPLIES' },
  Speakers:         { invCategorySlug: 'production-supplies',  dept: 'PRO_SUPPLIES' },
  'Climate Controls':{ invCategorySlug: 'production-supplies', dept: 'PRO_SUPPLIES' },
  // Communications gear
  Internet:         { invCategorySlug: 'production-supplies',  dept: 'COMMUNICATIONS' },
  Walkies:          { invCategorySlug: 'production-supplies',  dept: 'COMMUNICATIONS' },
  // Mixed bag — default to lighting; description override below catches
  // chargers and routes them to electrical-equipment.
  'Lights & Power': { invCategorySlug: 'lighting-equipment',   dept: 'GE' },
}

// Description-based overrides applied AFTER the RW.Category lookup. Each
// returns a complete Mapping (or null to keep the base lookup).
function descriptionOverride(rwCategory: string, description: string): Mapping | null {
  // Chargers in "Lights & Power" → electrical-equipment, not lighting.
  if (rwCategory === 'Lights & Power' && /charger/i.test(description)) {
    return { invCategorySlug: 'electrical-equipment', dept: 'GE' }
  }
  return null
}

async function main() {
  console.log(`RW catalog triage — ${APPLY ? '🚀 APPLY MODE (will write to DB)' : 'pre-flight only (no writes)'}`)

  // 1. Load needsReview items
  const items = await prisma.inventoryItem.findMany({
    where: { needsReview: true },
    select: {
      id: true, code: true, description: true,
      department: true, categoryId: true, rwId: true, qtyOwned: true,
    },
    orderBy: { qtyOwned: 'desc' },
  })
  console.log(`  ${items.length} needsReview items loaded`)

  // 2. Load InventoryCategory list (need their UUIDs)
  const cats = await prisma.inventoryCategory.findMany({
    select: { id: true, name: true, slug: true },
  })
  const catBySlug = new Map(cats.map((c) => [c.slug, c]))
  for (const slug of ['electrical-equipment', 'grip-equipment', 'lighting-equipment', 'production-supplies']) {
    if (!catBySlug.has(slug)) {
      throw new Error(`Required InventoryCategory slug missing: ${slug}`)
    }
  }

  // 3. Re-pull RW catalog so we can read RW.Category per row
  console.log('  Pulling RW catalog…')
  const rwItems = await fetchAllItems({ pageSize: 200, onPage: () => {} })
  const masters = groupItemsToMasters(rwItems)
  const rwByInvId = new Map(masters.map((m) => [m.rwInventoryId, m]))
  console.log(`  ${masters.length} RW masters loaded`)

  // 4. Plan the triage
  type Plan = {
    item: typeof items[number]
    rwCategory: string | null
    fromDept: LineItemDepartment
    fromCategoryId: string | null
    targetDept: LineItemDepartment
    targetCategoryId: string
    targetCategorySlug: string
    overrideReason: 'rw_category' | 'description_override'
  }
  type Skip = { item: typeof items[number]; reason: string }
  const plans: Plan[] = []
  const skips: Skip[] = []

  for (const it of items) {
    const rw = it.rwId ? rwByInvId.get(it.rwId) ?? null : null
    if (!rw) {
      skips.push({ item: it, reason: 'no RW master found by rwId' })
      continue
    }
    const rwCategory = rw.category ?? null
    if (!rwCategory) {
      skips.push({ item: it, reason: 'RW master has no Category' })
      continue
    }
    const base = RW_CATEGORY_MAP[rwCategory]
    if (!base) {
      skips.push({ item: it, reason: `RW.Category "${rwCategory}" has no mapping` })
      continue
    }
    const override = descriptionOverride(rwCategory, it.description ?? '')
    const final = override ?? base
    const cat = catBySlug.get(final.invCategorySlug)
    if (!cat) {
      skips.push({ item: it, reason: `target slug "${final.invCategorySlug}" not in InventoryCategory` })
      continue
    }
    plans.push({
      item: it,
      rwCategory,
      fromDept: it.department,
      fromCategoryId: it.categoryId,
      targetDept: final.dept,
      targetCategoryId: cat.id,
      targetCategorySlug: cat.slug,
      overrideReason: override ? 'description_override' : 'rw_category',
    })
  }

  // 5. Build report
  const lines: string[] = []
  const push = (s = '') => lines.push(s)
  push('# RW Catalog Triage — Pre-flight')
  push('')
  push(`Generated: ${new Date().toISOString()}`)
  push(`needsReview items: **${items.length}** · planned: **${plans.length}** · skipped: **${skips.length}**`)
  push('')

  // Summary by target dept
  const byDept = new Map<LineItemDepartment, number>()
  const bySlug = new Map<string, number>()
  const deptChanged = plans.filter((p) => p.fromDept !== p.targetDept).length
  for (const p of plans) {
    byDept.set(p.targetDept, (byDept.get(p.targetDept) ?? 0) + 1)
    bySlug.set(p.targetCategorySlug, (bySlug.get(p.targetCategorySlug) ?? 0) + 1)
  }
  push('## Summary')
  push('')
  push(`Of ${plans.length} planned rows, **${deptChanged}** would have their department changed and **${plans.length}** would be assigned a categoryId. All planned rows clear \`needsReview=false\` on apply.`)
  push('')
  push('Department after triage:')
  for (const [d, n] of [...byDept.entries()].sort((a, b) => b[1] - a[1])) push(`- ${d}: **${n}**`)
  push('')
  push('InventoryCategory after triage:')
  for (const [s, n] of [...bySlug.entries()].sort((a, b) => b[1] - a[1])) push(`- ${s}: **${n}**`)
  push('')

  // Per-row plan
  push('## Plan (per row)')
  push('')
  push('| code | description | RW.Category | dept change | category | rule |')
  push('|---|---|---|---|---|---|')
  for (const p of plans) {
    const deptChange = p.fromDept === p.targetDept ? p.targetDept : `${p.fromDept} → ${p.targetDept}`
    push(`| \`${p.item.code}\` | ${p.item.description ?? '—'} | ${p.rwCategory} | ${deptChange} | ${p.targetCategorySlug} | ${p.overrideReason} |`)
  }
  push('')

  // Skips
  push('## Skips (left at needsReview=true)')
  push('')
  if (skips.length === 0) {
    push('_(none)_')
  } else {
    for (const s of skips) push(`- \`${s.item.code}\` — ${s.item.description ?? '—'}: ${s.reason}`)
  }
  push('')

  const reportPath = path.join(process.cwd(), 'tmp/rw-triage-preflight.md')
  mkdirSync(path.dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, lines.join('\n'))

  console.log()
  console.log('───── SUMMARY ─────')
  console.log(`Planned:   ${plans.length}  (dept change on ${deptChanged}, category set on all)`)
  console.log(`Skipped:   ${skips.length}  (left at needsReview=true)`)
  console.log()
  console.log('After triage, dept distribution:')
  for (const [d, n] of [...byDept.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${d}: ${n}`)
  console.log()
  console.log('After triage, category distribution:')
  for (const [s, n] of [...bySlug.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${s}: ${n}`)
  console.log()
  console.log(`Report: ${reportPath}`)

  if (!APPLY) {
    console.log()
    console.log('🛑  Pre-flight only. Re-run with --apply to perform the triage.')
    await prisma.$disconnect()
    return
  }

  // 6. Apply
  console.log()
  console.log('🚀 APPLYING …')
  for (const p of plans) {
    await prisma.inventoryItem.update({
      where: { id: p.item.id },
      data: {
        department: p.targetDept,
        categoryId: p.targetCategoryId,
        needsReview: false,
      },
    })
  }
  console.log(`  ✓ ${plans.length} rows updated`)

  // 7. Applied report
  const applied: string[] = []
  applied.push('# RW Catalog Triage — Applied')
  applied.push('')
  applied.push(`Run at: ${new Date().toISOString()}`)
  applied.push('')
  applied.push(`- Triaged (needsReview cleared): **${plans.length}**`)
  applied.push(`- Department changes:            **${deptChanged}**`)
  applied.push(`- Categories assigned:           **${plans.length}**`)
  applied.push(`- Skipped (still needsReview):   **${skips.length}**`)
  applied.push('')
  applied.push('Department distribution post-triage:')
  for (const [d, n] of [...byDept.entries()].sort((a, b) => b[1] - a[1])) applied.push(`- ${d}: ${n}`)
  applied.push('')
  applied.push('Category distribution post-triage:')
  for (const [s, n] of [...bySlug.entries()].sort((a, b) => b[1] - a[1])) applied.push(`- ${s}: ${n}`)
  const appliedPath = path.join(process.cwd(), 'tmp/rw-triage-applied.md')
  writeFileSync(appliedPath, applied.join('\n'))
  console.log(`  Applied report: ${appliedPath}`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
