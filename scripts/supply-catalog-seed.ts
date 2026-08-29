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
 *   InventoryCategory.slug    (create-if-missing; update name only —
 *                              sortOrder and isActive are HQ's, and
 *                              categories now exist that this JSON
 *                              doesn't name: client-vip, vehicles,
 *                              stages. Renumbering from JSON position
 *                              would fight them.)
 *   InventoryItem.code        (create-if-missing; update fields below)
 *
 * Per item, the script sets:
 *   description, categoryId, dailyRate (from JSON.rate),
 *   department = the CATEGORY's department (see below),
 *   type = EQUIPMENT (unit=day) | EXPENDABLE (unit=ea),
 *   aliases (replace),
 *   publicVisible = true, isActive = true — but see Archiving.
 *
 * Anything NOT in the JSON is untouched — never written, never
 * deleted. The reconciliation report at the end lists what
 * changed.
 *
 * Aliases (2026-08-29). scripts/seed-catalog-aliases.ts OWNS the
 * aliases column — pinned by id, UNIONed on, with an explicit
 * `remove` list for taking one off, precisely so nothing curated gets
 * dropped. This script was replacing that column wholesale from its
 * own JSON, where most rows carry an empty list — so running it wiped
 * six curated lists including the flagship "walkies" → CP200 that the
 * schema comment cites as the example. It now only writes aliases
 * when the row has NONE (initial population) or on create; a row that
 * already has aliases keeps them.
 *
 * Visibility (2026-08-29). Same rule, same reason: the seed wrote
 * publicVisible=true on every update, so hiding an item from the
 * client form didn't stick either. Wes hid 27 covid-era rows on
 * 2026-07-05 (docs/cleanup/2026-07-05-covid-stock-hide.csv) — N95
 * masks, isolation gowns, face shields, sanitizing stations — and this
 * script would have put every one of them back on the public form. A
 * CREATE still lands publicVisible=true (a brand-new row carries no
 * operator decision); an UPDATE never flips false → true.
 *
 * Archiving (2026-08-29). Archiving a seed-owned item used to be
 * pointless: the next run wrote isActive=true unconditionally, so the
 * row came straight back publicVisible (COM-MOTOROLA-CP200-RADIO was
 * archived 2026-07-03 and this script would have resurrected it). The
 * archive flag is an OPERATOR decision and the seed no longer
 * overrules it — an archived row keeps isActive=false, archivedAt and
 * its publicVisible value. Its data fields (description, category,
 * rate, department, type, aliases) are still refreshed so the row is
 * current if someone restores it from the Archived view. Deleting a
 * code from the JSON does NOT archive anything — archiving is done in
 * HQ, and the footer reports which seed items are currently archived.
 *
 * Department (2026-08-29). This script used to stamp
 * `department: 'PRO_SUPPLIES'` on every row it wrote, regardless of
 * bucket — which is how 82 generators, ladders, hazers, steeldeck and
 * expendables ended up billing under Pro Supplies rate rules. Since
 * InventoryCategory now OWNS the department (the add-item modal asks
 * for one thing, not two), the seed takes the department from the
 * category it files the item under. A category the JSON declares with
 * no `department` keeps whatever the DB row already carries — this
 * script must never quietly re-flatten a department again.
 *
 * Dry-run by default; pass --write to commit.
 */

import { PrismaClient, type LineItemDepartment } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()
const args = process.argv.slice(2)
const dryRun = !args.includes('--write')

interface SeedCategory {
  name: string
  slug: string
  /** Optional. Set on a category the seed CREATES; an existing
   *  category's department is left to the DB (it's edited there, not
   *  here). Omitted → PRO_SUPPLIES via the column default. */
  department?: LineItemDepartment
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
  // slug → the department items in this category bill under. Read from
  // the live category row (the source of truth) so pass 2 never has to
  // guess, and a department edited in HQ survives a re-seed.
  const categoryDeptBySlug = new Map<string, LineItemDepartment>()

  for (let i = 0; i < seed.categories.length; i++) {
    const c = seed.categories[i]
    const sortOrder = i + 1
    const existing = await prisma.inventoryCategory.findUnique({
      where: { slug: c.slug },
      select: { id: true, name: true, sortOrder: true, isActive: true, department: true },
    })
    if (!existing) {
      console.log(`  [create-cat] ${c.slug.padEnd(28)} sortOrder=${sortOrder}  name="${c.name}"`)
      if (!dryRun) {
        const created = await prisma.inventoryCategory.create({
          data: {
            slug: c.slug,
            name: c.name,
            sortOrder,
            isActive: true,
            ...(c.department ? { department: c.department } : {}),
          },
          select: { id: true, department: true },
        })
        categoryIdBySlug.set(c.slug, created.id)
        categoryDeptBySlug.set(c.slug, created.department)
      } else {
        categoryIdBySlug.set(c.slug, `<dry-run-${c.slug}>`)
        categoryDeptBySlug.set(c.slug, c.department ?? 'PRO_SUPPLIES')
      }
      catCreated++
      continue
    }
    categoryIdBySlug.set(c.slug, existing.id)
    // An existing category's department is DB-owned — never overwritten
    // from the JSON. Items filed here inherit whatever it currently is.
    categoryDeptBySlug.set(c.slug, existing.department)
    // sortOrder and isActive on an EXISTING category are HQ's, not the
    // seed's — same rule as an item's publicVisible/isActive. Display
    // order especially: client-vip, vehicles and stages were created
    // outside this JSON, so numbering from JSON position would shuffle
    // the list every run. Only the display name is reconciled.
    const needsUpdate = existing.name !== c.name
    if (!needsUpdate) {
      catUnchanged++
      continue
    }
    console.log(`  [update-cat] ${c.slug.padEnd(28)} name "${existing.name}"→"${c.name}"`)
    if (!dryRun) {
      await prisma.inventoryCategory.update({
        where: { id: existing.id },
        data: { name: c.name },
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
  // Seed-owned codes an operator has archived. Counted, reported, and
  // never un-archived — the seed refreshes their data and moves on.
  const archivedKept: string[] = []
  // Seed-owned codes an operator has hidden from the client form.
  // Same contract as archivedKept — reported, never re-exposed.
  const hiddenKept: string[] = []

  for (const it of seed.items) {
    const categoryId = categoryIdBySlug.get(it.categorySlug)
    if (!categoryId) {
      console.log(`  [skip-orphan] code=${it.code}  unknown categorySlug="${it.categorySlug}"`)
      missingCategory++
      continue
    }
    const liType: 'EQUIPMENT' | 'EXPENDABLE' = it.unit === 'ea' ? 'EXPENDABLE' : 'EQUIPMENT'
    // The category owns the department. Was hardcoded PRO_SUPPLIES,
    // which is what put generators and ladders in the Pro Supplies
    // billing lane. Falls back to PRO_SUPPLIES only if pass 1 somehow
    // didn't see the category (it always does — same slug map).
    const itemDept: LineItemDepartment = categoryDeptBySlug.get(it.categorySlug) ?? 'PRO_SUPPLIES'

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
      console.log(`  [create-item] ${it.code.padEnd(34)} ${liType.padEnd(10)} $${it.rate}/${it.unit}  cat=${it.categorySlug}  dept=${itemDept}`)
      if (!dryRun) {
        await prisma.inventoryItem.create({
          data: {
            code: it.code,
            description: it.description,
            categoryId,
            dailyRate: it.rate,
            department: itemDept,
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
    // Aliases are the alias seed's, not ours — only populate an empty
    // column. A row that already carries curated synonyms is left
    // alone, so this script can never be the thing that drops one.
    const seedAliases = existing.aliases.length === 0
    const aliasSame = !seedAliases ||
      (existing.aliases.length === it.aliases.length &&
        existing.aliases.every((a) => it.aliases.includes(a)))
    // isActive and publicVisible are operator-owned on any row that
    // already exists — archiving and hiding are decisions made in HQ,
    // and the seed's job is the catalog DATA, not the shelf it sits on.
    // Neither is compared, and neither is written on an update.
    const archived = !existing.isActive
    if (archived) archivedKept.push(it.code)
    if (!existing.publicVisible) hiddenKept.push(it.code)
    const needsUpdate =
      existing.description !== it.description ||
      existing.categoryId !== categoryId ||
      Number(existing.dailyRate) !== it.rate ||
      existing.department !== itemDept ||
      existing.type !== liType ||
      !aliasSame

    if (!needsUpdate) {
      itemUnchanged++
      continue
    }
    console.log(`  [${archived ? 'update-archived' : 'update-item'}] ${it.code.padEnd(34)} ${liType.padEnd(10)} $${it.rate}/${it.unit}  cat=${it.categorySlug}  dept=${itemDept}${existing.department !== itemDept ? ` (was ${existing.department})` : ''}${archived ? '  [stays archived]' : ''}${!existing.publicVisible && !archived ? '  [stays hidden]' : ''}`)
    if (!dryRun) {
      await prisma.inventoryItem.update({
        where: { code: it.code },
        data: {
          description: it.description,
          categoryId,
          dailyRate: it.rate,
          department: itemDept,
          type: liType,
          ...(seedAliases ? { aliases: it.aliases } : {}),
          // NOT written on an existing row: publicVisible, isActive,
          // archivedAt, and aliases that are already curated. See the
          // Aliases / Visibility / Archiving notes up top.
        },
      })
    }
    itemUpdated++
  }
  console.log(`  items — created: ${itemCreated}, updated: ${itemUpdated}, unchanged: ${itemUnchanged}, orphan-skipped: ${missingCategory}\n`)
  if (hiddenKept.length) {
    console.log(`  ${hiddenKept.length} seed item(s) hidden from the client form in HQ — left hidden, data refreshed:`)
    for (const c of hiddenKept) console.log(`    ${c}`)
    console.log('')
  }
  if (archivedKept.length) {
    console.log(`  ${archivedKept.length} seed item(s) archived in HQ — left archived, data refreshed:`)
    for (const c of archivedKept) console.log(`    ${c}`)
    console.log('')
  }

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
