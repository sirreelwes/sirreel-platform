/*
 * Native supply-catalog seed.
 *
 * Source of truth: scripts/supply-catalog-seed.json (categories +
 * items extracted from the Production Supplies PDF / mockup). The
 * seed is fully native — it does NOT query, match, or merge against
 * any RW-imported InventoryItem rows. Legacy RW catalog rows stay
 * dormant (publicVisible=false) and are out of scope here.
 *
 * Idempotent. Re-runs upsert by:
 *   InventoryCategory.slug    (create-if-missing; update name + sortOrder)
 *   InventoryItem.code        (create-if-missing; update fields below)
 *
 * Per item, the script sets:
 *   description, categoryId, dailyRate (from JSON.rate),
 *   department = PRO_SUPPLIES,
 *   type = EQUIPMENT (unit=day) | EXPENDABLE (unit=ea),
 *   aliases (replace),
 *   publicVisible = true, isActive = true.
 *
 * Anything NOT in the JSON is untouched — never written, never
 * deleted. The reconciliation report at the end lists what
 * changed.
 *
 * Dry-run by default; pass --write to commit.
 */

import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()
const args = process.argv.slice(2)
const dryRun = !args.includes('--write')

interface SeedCategory {
  name: string
  slug: string
}

interface SeedItem {
  code: string
  description: string
  categorySlug: string
  rate: number
  unit: 'day' | 'ea'
  aliases: string[]
}

interface SeedFile {
  categories: SeedCategory[]
  items: SeedItem[]
}

async function main() {
  console.log(`Supply catalog seed — ${dryRun ? 'DRY RUN' : 'LIVE WRITE'}\n`)

  const jsonPath = path.join(__dirname, 'supply-catalog-seed.json')
  const seed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as SeedFile

  console.log(`Source: ${jsonPath}`)
  console.log(`  ${seed.categories.length} categories, ${seed.items.length} items\n`)

  // ── PASS 1: categories ──
  let catCreated = 0
  let catUpdated = 0
  let catUnchanged = 0
  const categoryIdBySlug = new Map<string, string>()

  for (let i = 0; i < seed.categories.length; i++) {
    const c = seed.categories[i]
    const sortOrder = i + 1
    const existing = await prisma.inventoryCategory.findUnique({
      where: { slug: c.slug },
      select: { id: true, name: true, sortOrder: true, isActive: true },
    })
    if (!existing) {
      console.log(`  [create-cat] ${c.slug.padEnd(28)} sortOrder=${sortOrder}  name="${c.name}"`)
      if (!dryRun) {
        const created = await prisma.inventoryCategory.create({
          data: { slug: c.slug, name: c.name, sortOrder, isActive: true },
          select: { id: true },
        })
        categoryIdBySlug.set(c.slug, created.id)
      } else {
        categoryIdBySlug.set(c.slug, `<dry-run-${c.slug}>`)
      }
      catCreated++
      continue
    }
    categoryIdBySlug.set(c.slug, existing.id)
    const needsUpdate = existing.name !== c.name || existing.sortOrder !== sortOrder || !existing.isActive
    if (!needsUpdate) {
      catUnchanged++
      continue
    }
    console.log(`  [update-cat] ${c.slug.padEnd(28)} sortOrder ${existing.sortOrder}→${sortOrder}  name "${existing.name}"→"${c.name}"`)
    if (!dryRun) {
      await prisma.inventoryCategory.update({
        where: { id: existing.id },
        data: { name: c.name, sortOrder, isActive: true },
      })
    }
    catUpdated++
  }
  console.log(`  categories — created: ${catCreated}, updated: ${catUpdated}, unchanged: ${catUnchanged}\n`)

  // ── PASS 2: items ──
  let itemCreated = 0
  let itemUpdated = 0
  let itemUnchanged = 0
  let missingCategory = 0

  for (const it of seed.items) {
    const categoryId = categoryIdBySlug.get(it.categorySlug)
    if (!categoryId) {
      console.log(`  [skip-orphan] code=${it.code}  unknown categorySlug="${it.categorySlug}"`)
      missingCategory++
      continue
    }
    const liType: 'EQUIPMENT' | 'EXPENDABLE' = it.unit === 'ea' ? 'EXPENDABLE' : 'EQUIPMENT'

    const existing = await prisma.inventoryItem.findUnique({
      where: { code: it.code },
      select: {
        id: true,
        description: true,
        categoryId: true,
        dailyRate: true,
        department: true,
        type: true,
        aliases: true,
        publicVisible: true,
        isActive: true,
      },
    })

    if (!existing) {
      console.log(`  [create-item] ${it.code.padEnd(34)} ${liType.padEnd(10)} $${it.rate}/${it.unit}  cat=${it.categorySlug}`)
      if (!dryRun) {
        await prisma.inventoryItem.create({
          data: {
            code: it.code,
            description: it.description,
            categoryId,
            dailyRate: it.rate,
            department: 'PRO_SUPPLIES',
            type: liType,
            aliases: it.aliases,
            publicVisible: true,
            isActive: true,
          },
        })
      }
      itemCreated++
      continue
    }

    // Compare every field we own. Aliases compared as sets so order doesn't matter.
    const aliasSame =
      existing.aliases.length === it.aliases.length &&
      existing.aliases.every((a) => it.aliases.includes(a))
    const needsUpdate =
      existing.description !== it.description ||
      existing.categoryId !== categoryId ||
      Number(existing.dailyRate) !== it.rate ||
      existing.department !== 'PRO_SUPPLIES' ||
      existing.type !== liType ||
      !aliasSame ||
      existing.publicVisible !== true ||
      existing.isActive !== true

    if (!needsUpdate) {
      itemUnchanged++
      continue
    }
    console.log(`  [update-item] ${it.code.padEnd(34)} ${liType.padEnd(10)} $${it.rate}/${it.unit}  cat=${it.categorySlug}`)
    if (!dryRun) {
      await prisma.inventoryItem.update({
        where: { code: it.code },
        data: {
          description: it.description,
          categoryId,
          dailyRate: it.rate,
          department: 'PRO_SUPPLIES',
          type: liType,
          aliases: it.aliases,
          publicVisible: true,
          isActive: true,
        },
      })
    }
    itemUpdated++
  }
  console.log(`  items — created: ${itemCreated}, updated: ${itemUpdated}, unchanged: ${itemUnchanged}, orphan-skipped: ${missingCategory}\n`)

  // ── Footer / sanity ──
  const totalPublic = await prisma.inventoryItem.count({ where: { publicVisible: true } })
  const totalPrivate = await prisma.inventoryItem.count({ where: { publicVisible: false } })
  console.log('Post-seed inventory_items state:')
  console.log(`  publicVisible=true:  ${totalPublic}${dryRun ? ' (projected after --write)' : ''}`)
  console.log(`  publicVisible=false: ${totalPrivate}  (untouched legacy / RW rows)`)
  console.log('')

  if (dryRun) {
    console.log('DRY RUN. Re-run with --write to apply.')
  } else {
    console.log('Done.')
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
