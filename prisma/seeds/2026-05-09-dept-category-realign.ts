/**
 * One-shot data-hygiene sweep — align inventory_items.department with
 * inventory_categories.slug. Pre-existing artifact of the Phase 2
 * keyword-only department backfill; surfaced when verifying the May 9
 * RW triage.
 *
 * Rules:
 *   - lighting-equipment    → GE (regardless of current dept)
 *   - grip-equipment        → GE
 *   - electrical-equipment  → GE, except COMMUNICATIONS rows stay
 *                             (radios/walkies categorized electrical
 *                             but correctly tagged comms)
 *   - production-supplies   → PRO_SUPPLIES, except COMMUNICATIONS and
 *                             EXPENDABLES rows stay (mifi devices,
 *                             true expendables)
 *
 * Idempotent: re-running converges to the same state.
 *
 * Run:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx prisma/seeds/2026-05-09-dept-category-realign.ts
 */

import { prisma } from '../../src/lib/prisma'
import type { LineItemDepartment } from '@prisma/client'

const SLUG_TO_DEPT: Record<string, LineItemDepartment> = {
  'lighting-equipment':  'GE',
  'grip-equipment':      'GE',
  'electrical-equipment': 'GE',
  'production-supplies': 'PRO_SUPPLIES',
}

// For these slugs, leave rows already in COMMUNICATIONS or EXPENDABLES alone.
const KEEP_AS_IS: Record<string, LineItemDepartment[]> = {
  'electrical-equipment':  ['COMMUNICATIONS'],
  'production-supplies':   ['COMMUNICATIONS', 'EXPENDABLES'],
  // grip-equipment / lighting-equipment have no legitimate non-GE dept.
}

async function main() {
  const items = await prisma.inventoryItem.findMany({
    select: {
      id: true,
      code: true,
      description: true,
      department: true,
      category: { select: { slug: true } },
    },
  })

  const planned: { id: string; from: LineItemDepartment; to: LineItemDepartment; slug: string; code: string }[] = []
  for (const it of items) {
    const slug = it.category?.slug
    if (!slug) continue
    const target = SLUG_TO_DEPT[slug]
    if (!target) continue
    const keep = KEEP_AS_IS[slug] ?? []
    if (keep.includes(it.department)) continue
    if (it.department === target) continue
    planned.push({ id: it.id, from: it.department, to: target, slug, code: it.code })
  }

  console.log(`Sweep target: ${planned.length} rows`)
  const summary = new Map<string, number>()
  for (const p of planned) {
    const k = `${p.slug} ${p.from} → ${p.to}`
    summary.set(k, (summary.get(k) ?? 0) + 1)
  }
  for (const [k, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${k}`)
  }

  for (const p of planned) {
    await prisma.inventoryItem.update({ where: { id: p.id }, data: { department: p.to } })
  }
  console.log(`✓ ${planned.length} rows updated`)

  // Verify
  const post: { slug: string; department: string; n: bigint }[] = await prisma.$queryRaw`
    SELECT c.slug, i.department::text AS department, count(*)::bigint AS n
    FROM inventory_items i
    JOIN inventory_categories c ON c.id = i.category_id
    GROUP BY c.slug, i.department
    ORDER BY c.slug, i.department`
  console.log()
  console.log('Post-sweep cross-tab:')
  for (const r of post) console.log(`  ${r.slug.padEnd(24)} ${r.department.padEnd(16)} ${Number(r.n)}`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
