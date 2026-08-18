#!/usr/bin/env tsx
/**
 * Companion to scheduling-planyo-migration.ts.
 *
 * Adds the AssetCategory + Asset rows the Planyo migration needs to
 * land with zero genuinely-unmatched units. Two top-level proposal
 * lists below — PROPOSED_CATEGORIES (new bookable buckets) and
 * PROPOSED_ASSETS (new units within categories).
 *
 * Idempotent: existing categories/assets are detected and skipped.
 *
 * Usage:
 *   npx tsx scripts/scheduling-add-missing-assets.ts            # dry run (default)
 *   npx tsx scripts/scheduling-add-missing-assets.ts --write    # persist
 *
 * Reconciliation notes for the 7 originally-unmatched units:
 *   • Video Van (w/ MiFi)        → CREATE (this script): one Asset in ProScout / VTR
 *   • Scout Van (No MiFi)        → ALIAS, not a new Asset: same physical unit as
 *                                  Video Van (w/ MiFi). Handled by the migration
 *                                  script's NAME_ALIASES map — NOT here.
 *   • Lankershim Studio (Planyo) → ROUTED, not a new Asset by itself: migration
 *                                  routes Planyo "Lankershim Studio" reservations
 *                                  to the new "Lankershim Studios" CATEGORY this
 *                                  script creates, with 4 specific room Assets.
 *                                  Migration leaves the per-reservation
 *                                  BookingItem REQUESTED (no BookingAssignment)
 *                                  because the Planyo data doesn't say which
 *                                  room — agent assigns post-import.
 *   • Sprinter #1 / #2 (Planyo)  → UNASSIGNED Cargo-w-Liftgate holds: migration
 *                                  creates BookingItems with no BookingAssignment
 *                                  until fleet provides the specific Cargo unit
 *                                  mapping. Not added as Assets here.
 *   • 30 (A) Wardrobe (Planyo)   → ALIAS to existing Cube 30 (no separate
 *                                  wardrobe truck exists). Handled by the
 *                                  migration script's NAME_ALIASES map.
 *   • X - 2ND HOLD               → Backup-hold (rank ≥ 2) BookingItem. Handled
 *                                  by the migration script's holdRank logic.
 */

import { readFileSync } from 'fs'
import path from 'path'
import {
  PrismaClient,
  type AssetTier,
  type AssetStatus,
  type Location,
  type LineItemDepartment,
} from '@prisma/client'

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const prisma = new PrismaClient()
const dryRun = !process.argv.includes('--write')

// ──────────────────────────────────────────────────────────────
// PROPOSED CATEGORIES — review with Julian before --write.
// dailyRate defaults to 0; fleet should set the real rate via
// the inventory UI before the category is used in quotes.
// ──────────────────────────────────────────────────────────────

interface ProposedCategory {
  name: string
  slug: string
  totalUnits: number
  dailyRate: number
  department: LineItemDepartment
  planyoResourceId?: number | null
  description?: string
  reviewNote: string
  /** Storefront/quote visibility. AssetCategory.isPublished DEFAULTS
   *  TRUE, and the first --write run shipped both new categories
   *  published at dailyRate $0 — a pricing decision nobody made,
   *  surfaced by a migration prep script. Proposals here are created
   *  UNPUBLISHED unless explicitly opted in; publishing (with a real
   *  rate) stays a human decision in Fleet Pricing. */
  isPublished?: boolean
  /** Operator gantt "+ Hold" picker visibility. Empty placeholder
   *  categories (0 assets) should opt out — every hold against them
   *  gate-blocks, so they are pure picker noise. */
  reservableOnGantt?: boolean
}

const PROPOSED_CATEGORIES: ProposedCategory[] = [
  {
    name: 'Lankershim Studios',
    slug: 'lankershim-studios',
    totalUnits: 4,
    dailyRate: 0,
    department: 'STAGES',
    planyoResourceId: null,
    description:
      'Bookable stages at the Lankershim location (Hospital Set, Police Set, LED Stage, Black Box). Distinct from the legacy "Studios" / Standing Sets bucket.',
    reviewNote:
      'Planyo currently lumps Lankershim spaces under its generic "Studios" resource (id 128064). If a dedicated Planyo resource id exists for Lankershim Studios, set planyoResourceId on this row so the migration routes by resource_id rather than by unit-name override.',
  },
  {
    name: 'Wardrobe',
    slug: 'wardrobe',
    totalUnits: 0,
    dailyRate: 0,
    department: 'PRO_SUPPLIES',
    planyoResourceId: null,
    description: 'Placeholder for a future wardrobe-truck / wardrobe-space buildout. No Assets yet.',
    reviewNote: 'Empty (totalUnits=0) on purpose — placeholder for future expansion.',
    reservableOnGantt: false,
  },
]

// ──────────────────────────────────────────────────────────────
// PROPOSED ASSETS — review with Julian before --write.
// Default tier=STANDARD, status=AVAILABLE, location=LANKERSHIM.
// ──────────────────────────────────────────────────────────────

interface ProposedAsset {
  categoryName: string
  unitName: string
  tier?: AssetTier
  status?: AssetStatus
  location?: Location
  notes?: string
  reviewNote: string
}

const PROPOSED_ASSETS: ProposedAsset[] = [
  {
    // Category was renamed "ProScout / VTR" → "ProScout / VideoVan"
    // (slug stayed proscout-vtr; see merge-proscout-vtr-dup.ts). The
    // lookup here is by NAME, so the stale name hard-aborted the whole
    // run via the unknown-category guard — before Lankershim ever got
    // proposed.
    categoryName: 'ProScout / VideoVan',
    unitName: 'Video Van',
    notes:
      'Planyo has two names for this same physical unit: "Video Van (w/ MiFi)" and "Scout Van (No MiFi)". Distinct one-of-a-kind unit. The migration script aliases "Scout Van" → this Asset.',
    reviewNote: 'Confirmed: one physical unit, two Planyo names. Only ONE Asset row exists here.',
  },
  {
    categoryName: 'Lankershim Studios',
    unitName: 'Hospital Set',
    reviewNote: '1 of 4 bookable spaces at the Lankershim location.',
  },
  {
    categoryName: 'Lankershim Studios',
    unitName: 'Police Set',
    reviewNote: '2 of 4 bookable spaces at the Lankershim location.',
  },
  {
    categoryName: 'Lankershim Studios',
    unitName: 'LED Stage',
    reviewNote: '3 of 4 bookable spaces at the Lankershim location.',
  },
  {
    categoryName: 'Lankershim Studios',
    unitName: 'Black Box',
    reviewNote: '4 of 4 bookable spaces at the Lankershim location.',
  },
  // ── Sprinters — fleet confirmed (2026-05-23) that these are three
  //    distinct units within Cargo Van w/ Liftgate, not aliases. The
  //    Planyo names are "Sprinter #1 (A)" / "Sprinter #2 (A)" /
  //    "Sprinter #4"; the migration's name normalizer strips the
  //    "#" + "(A)" → "Sprinter 1" / "Sprinter 2" / "Sprinter 4",
  //    which is the unitName these rows expose.
  {
    categoryName: 'Cargo Van w/ Liftgate',
    unitName: 'Sprinter 1',
    reviewNote: 'Fleet-confirmed distinct unit in Cargo Van w/ Liftgate (Planyo: "Sprinter #1 (A)").',
  },
  {
    categoryName: 'Cargo Van w/ Liftgate',
    unitName: 'Sprinter 2',
    reviewNote: 'Fleet-confirmed distinct unit in Cargo Van w/ Liftgate (Planyo: "Sprinter #2 (A)").',
  },
  {
    categoryName: 'Cargo Van w/ Liftgate',
    unitName: 'Sprinter 4',
    reviewNote: 'Fleet-confirmed distinct unit in Cargo Van w/ Liftgate (Planyo: "Sprinter #4").',
  },
]

// ──────────────────────────────────────────────────────────────
// HELD FOR DECISION / not added by this script — these are
// resolved via migration-script aliases or via the holdRank queue.
// ──────────────────────────────────────────────────────────────

const HOLD_FOR_DECISION = [
  {
    planyoName: 'Scout Van (No MiFi)',
    note: 'Aliased to "Video Van" by NAME_ALIASES in the migration script. Same physical unit.',
  },
  {
    planyoName: '30 (A) Wardrobe',
    note: 'Aliased to existing "Cube 30" by NAME_ALIASES in the migration script. Wardrobe is a config note on Cube 30, not a separate asset or category. A future "wardrobe add-on for any cube" is a different feature, out of scope here.',
  },
  // Sprinter #1/#2/#4 — RESOLVED 2026-05-23: now created as
  // distinct Assets in Cargo Van w/ Liftgate (see PROPOSED_ASSETS
  // above). The migration script's Sprinter unassigned-holds
  // fallback has been removed.
  {
    planyoName: 'Lankershim Studio (generic) — no room specified',
    note:
      'Planyo reservations only say "Lankershim Studio" without a room. Migration creates an unassigned BookingItem in the new "Lankershim Studios" category for an agent to pick the specific room (Hospital Set / Police Set / LED Stage / Black Box).',
  },
  {
    planyoName: 'X - 2ND HOLD (Planyo workaround)',
    note: 'Handled by Part B holdRank logic: migration creates a rank-2 BookingItem flagged for manual linkage to the primary it backs up.',
  },
]

async function main() {
  console.log(`Scheduling — proposed additions — ${dryRun ? 'DRY RUN' : 'LIVE WRITE'}`)
  console.log('')

  // ── CATEGORIES ──
  console.log('PROPOSED CATEGORIES:')
  console.log('─'.repeat(80))
  const existingCategories = await prisma.assetCategory.findMany({ select: { id: true, name: true, slug: true } })
  const categoryByName = new Map(existingCategories.map((c) => [c.name, c]))
  const categoryBySlug = new Map(existingCategories.map((c) => [c.slug, c]))
  let catCreated = 0
  let catSkipped = 0
  for (const pc of PROPOSED_CATEGORIES) {
    const existsByName = categoryByName.get(pc.name)
    const existsBySlug = categoryBySlug.get(pc.slug)
    const existing = existsByName ?? existsBySlug
    const tag = existing ? 'EXISTS' : 'NEW   '
    console.log(`  [${tag}] "${pc.name}" (slug: ${pc.slug}, totalUnits: ${pc.totalUnits}, department: ${pc.department})`)
    console.log(`           ${pc.reviewNote}`)
    if (existing) { catSkipped++; continue }
    catCreated++
    if (!dryRun) {
      const created = await prisma.assetCategory.create({
        data: {
          name: pc.name,
          slug: pc.slug,
          totalUnits: pc.totalUnits,
          dailyRate: pc.dailyRate,
          department: pc.department,
          planyoResourceId: pc.planyoResourceId ?? null,
          description: pc.description ?? null,
          isPublished: pc.isPublished ?? false,
          reservableOnGantt: pc.reservableOnGantt ?? true,
        },
        select: { id: true, name: true, slug: true },
      })
      categoryByName.set(created.name, created)
      categoryBySlug.set(created.slug, created)
      console.log(`           → created (id ${created.id})`)
    }
  }

  // ── InventoryItem mirrors ─────────────────────────────────────
  //
  // Fleet Pricing, the holds route, and the availability engine all read
  // the MERGED catalog (InventoryItem, keyed by legacyAssetCategoryId) —
  // AssetCategory is the frozen half. This script predates the merge and
  // created only AssetCategory rows, which made "Lankershim Studios"
  // invisible on the Pricing page: no mirror row, no way to set its rate,
  // and every reader fell back to the frozen $0.
  //
  // Runs OUTSIDE the categories-created branch on purpose: a prior run
  // may have created the category while this mirror step didn't exist
  // yet (exactly what happened on 2026-08-18), so mirrors are checked
  // for every proposal, not just fresh categories. Idempotent by
  // legacyAssetCategoryId.
  const codeFromName = (name: string) =>
    `CAT_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`
  console.log('')
  console.log('INVENTORY MIRRORS (merged catalog):')
  console.log('─'.repeat(80))
  for (const pc of PROPOSED_CATEGORIES) {
    const cat = categoryBySlug.get(pc.slug)
    if (!cat) { console.log(`  [SKIP  ] "${pc.name}" — category not present (dry run before create)`); continue }
    const mirror = await prisma.inventoryItem.findUnique({
      where: { legacyAssetCategoryId: cat.id },
      select: { id: true },
    })
    if (mirror) { console.log(`  [EXISTS] "${pc.name}" → InventoryItem ${mirror.id}`); continue }
    if (dryRun) { console.log(`  [NEW   ] "${pc.name}" (dry: would create ${codeFromName(pc.name)})`); continue }
    const created = await prisma.inventoryItem.create({
      data: {
        code: codeFromName(pc.name),
        slug: pc.slug,
        description: pc.name,
        trackingMode: 'UNIT_TRACKED',
        legacyAssetCategoryId: cat.id,
        department: pc.department,
        type: 'EQUIPMENT',
        dailyRate: pc.dailyRate,
        weeklyRate: 0,
        qtyOwned: pc.totalUnits,
        planyoResourceId: pc.planyoResourceId ?? null,
        // Mirrors the category's visibility decisions: unpublished until
        // a human sets a rate and flips it in Fleet Pricing.
        publicVisible: pc.isPublished ?? false,
        reservableOnGantt: pc.reservableOnGantt ?? true,
        isActive: true,
      },
      select: { id: true, code: true },
    })
    console.log(`  [NEW   ] "${pc.name}" → created InventoryItem ${created.code} (${created.id})`)
  }

  // Validate every proposed Asset has its category resolvable.
  const allCatsForLookup = await prisma.assetCategory.findMany({ select: { id: true, name: true } })
  const catLookup = new Map(allCatsForLookup.map((c) => [c.name, c]))
  // Also project the dry-run "would-be-created" categories so Asset
  // validation passes against them.
  for (const pc of PROPOSED_CATEGORIES) {
    if (!catLookup.has(pc.name)) catLookup.set(pc.name, { id: `DRY-NEW-CAT:${pc.slug}`, name: pc.name })
  }

  const missingCats = PROPOSED_ASSETS.map((p) => p.categoryName).filter((n) => !catLookup.has(n))
  if (missingCats.length > 0) {
    console.error(`\nProposed Assets reference unknown categories: ${[...new Set(missingCats)].join(', ')}`)
    process.exit(1)
  }

  // ── ASSETS ──
  console.log('')
  console.log('PROPOSED ASSETS:')
  console.log('─'.repeat(80))
  const existingAssets = await prisma.asset.findMany({ select: { id: true, categoryId: true, unitName: true } })
  const assetKey = (catId: string, name: string) => `${catId}|${name}`
  const existingAssetSet = new Set(existingAssets.map((a) => assetKey(a.categoryId, a.unitName)))

  let assetCreated = 0
  let assetSkipped = 0
  for (const pa of PROPOSED_ASSETS) {
    const cat = catLookup.get(pa.categoryName)!
    const key = assetKey(cat.id, pa.unitName)
    const exists = existingAssetSet.has(key)
    const tag = exists ? 'EXISTS' : 'NEW   '
    console.log(`  [${tag}] ${pa.categoryName} / "${pa.unitName}"`)
    console.log(`           ${pa.reviewNote}`)
    if (exists) { assetSkipped++; continue }
    if (cat.id.startsWith('DRY-NEW-CAT:')) {
      // Category itself is dry-run; can't create yet.
      console.log(`           (dry: would create after category "${pa.categoryName}" is created)`)
      assetCreated++
      continue
    }
    assetCreated++
    if (!dryRun) {
      await prisma.asset.create({
        data: {
          categoryId: cat.id,
          unitName: pa.unitName,
          tier: pa.tier ?? 'STANDARD',
          status: pa.status ?? 'AVAILABLE',
          location: pa.location ?? 'LANKERSHIM',
          notes: [pa.notes, `Auto-created by scheduling-add-missing-assets on ${new Date().toISOString().slice(0, 10)}`]
            .filter(Boolean).join('\n'),
        },
      })
      console.log(`           → created`)
    }
  }

  // ── DECISIONS NOT ADDED ──
  console.log('')
  console.log('HANDLED ELSEWHERE — not added by this script:')
  console.log('─'.repeat(80))
  for (const h of HOLD_FOR_DECISION) {
    console.log(`  "${h.planyoName}"`)
    console.log(`    ${h.note}`)
  }

  console.log('')
  console.log(
    `Summary: categories ${catCreated} create / ${catSkipped} exist · assets ${assetCreated} create / ${assetSkipped} exist · ${HOLD_FOR_DECISION.length} handled elsewhere`,
  )
  if (dryRun) console.log('(dry run — pass --write to persist)')
}

main()
  .catch((e) => { console.error('[add-missing-assets] fatal:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
