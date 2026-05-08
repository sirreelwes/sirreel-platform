/**
 * Phase 2 sales pipeline rework — one-time catalog seed.
 *
 *   1. Sets `aliases` on a curated list of high-volume / high-traffic
 *      InventoryItem and AssetCategory rows so the AI quote extractor
 *      and the server-side alias-tokenized fallback can resolve common
 *      producer-speak (walkies → CP200 Radio, etc.).
 *   2. Backfills `department` on every InventoryItem (keyword pass over
 *      `description` / `code`, first-match-wins) and every AssetCategory
 *      (Studios → STAGES, everything else → VEHICLES).
 *   3. Tightens both `department` columns to NOT NULL.
 *
 * Idempotent: re-running overwrites with the same patches; safe to invoke
 * after manual alias edits in the wild (those will be wiped — extend this
 * list before re-running).
 *
 * Run:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx prisma/seeds/2026-05-08-catalog-aliases.ts
 */

import { prisma } from '../../src/lib/prisma'
import type { LineItemDepartment } from '@prisma/client'

// ─────────────────────────────────────────────────────────────────────────
// Curated alias patches. `match` is a case-insensitive ILIKE on
// inventory_items.code. The first row whose code contains the substring
// gets the alias list. (We curate by code rather than UUID because UUIDs
// are unstable across environments.)
// ─────────────────────────────────────────────────────────────────────────
const INVENTORY_ALIASES: { codeContains: string; aliases: string[] }[] = [
  {
    codeContains: 'CP200',
    aliases: [
      'walkies', 'walkie', 'walkie talkie', 'walkie talkies',
      'handheld', 'handhelds', 'two-way radio', 'two way radio',
      'radios', 'radio', 'cp200',
    ],
  },
  {
    codeContains: 'Surveillance Kit',
    aliases: [
      'surveillance', 'surveillances', 'earpiece', 'earpieces',
      'surveillance kit', 'shoulder mic',
    ],
  },
  {
    codeContains: 'Folding Chair',
    aliases: ['chair', 'chairs', 'folding chair', 'folding chairs'],
  },
  {
    codeContains: 'Folding Table',
    aliases: ['table', 'tables', 'folding table', '6 foot table', "6' table"],
  },
  {
    codeContains: '25 LB. SANDBAG',
    aliases: [
      'sandbag', 'sandbags', '25 lb sandbag', '25lb sandbag',
      '25 pound sandbag', 'shot bag',
    ],
  },
  {
    codeContains: 'Furniture Pads',
    aliases: [
      'furniture pad', 'pads', 'blanket', 'blankets',
      'moving pads', 'moving blankets', 'sound blankets',
    ],
  },
  {
    codeContains: 'Safety Vest',
    aliases: ['vest', 'vests', 'safety vest', 'safety vests', 'hi-vis', 'hi-vis vest'],
  },
  {
    codeContains: 'Ratchet Straps',
    aliases: [
      'ratchet', 'ratchets', 'strap', 'straps',
      'tie-down', 'tie-downs', 'tiedowns', 'ratchet strap',
    ],
  },
  {
    codeContains: 'APPLE BOX - FULL',
    aliases: ['apple box', 'apple boxes', 'full apple', 'full apples'],
  },
  {
    codeContains: 'APPLE BOX - HALF',
    aliases: ['half apple', 'half apples', 'half-apple'],
  },
  {
    codeContains: 'APPLE BOX - QUARTER',
    aliases: ['quarter apple', 'quarter apples'],
  },
  {
    codeContains: 'APPLE BOX - PANCAKE',
    aliases: ['pancake', 'pancakes'],
  },
  {
    codeContains: '40" C-STAND',
    aliases: ['c-stand', 'c stand', 'c-stands', 'cstand', '40 c-stand', '40-inch c-stand'],
  },
  {
    codeContains: 'LOW C-STAND',
    aliases: ['low c-stand', 'low boy', 'low-boy', 'low stand'],
  },
  {
    codeContains: 'CARDELLINI CLAMP CENTER JAW',
    aliases: ['cardellini', 'cardellini clamp', 'center jaw cardellini'],
  },
  {
    codeContains: 'Honda 2000 Watt Generator',
    aliases: ['honda 2000', '2k generator', '2000 watt generator', 'honda 2k'],
  },
  {
    codeContains: 'Honda 3000 Watt Generator',
    aliases: ['honda 3000', '3k generator'],
  },
  {
    codeContains: 'Honda 6500 Watt Generator',
    aliases: ['honda 6500', '6.5k generator', '6500 watt generator'],
  },
  {
    codeContains: 'Honda 7000 Watt Generator',
    aliases: ['honda 7000', '7k generator', '7000 watt generator'],
  },
]

const ASSET_CATEGORY_ALIASES: { slug: string; aliases: string[] }[] = [
  { slug: 'cube-truck',           aliases: ['cube', 'cubes', 'cube truck', 'cube trucks'] },
  { slug: 'camera-cube',          aliases: ['camera cube', 'camera truck', 'cam cube'] },
  { slug: 'cargo-van-liftgate',   aliases: ['cargo van with liftgate', 'liftgate van', 'lift van'] },
  { slug: 'cargo-van-no-liftgate', aliases: ['cargo van', 'cargo vans', 'van', 'cargo van no lift'] },
  { slug: 'passenger-van',        aliases: ['passenger van', 'pass van', 'pax van', '12 passenger', '12-pass'] },
  { slug: 'studios',              aliases: ['stage', 'stages', 'soundstage', 'soundstages', 'studio', 'sound stage'] },
  { slug: 'popvan',               aliases: ['popvan', 'pop van', 'pop-van'] },
  { slug: 'stakebed',             aliases: ['stakebed', 'stake bed', 'flatbed'] },
  { slug: 'scissor-lift',         aliases: ['scissor lift', 'lift', 'scissorlift'] },
  { slug: 'proscout-vtr',         aliases: ['proscout', 'pro scout', 'vtr', 'video village'] },
]

// ─────────────────────────────────────────────────────────────────────────
// Department keyword pass for InventoryItem.
// First match wins; PRO_SUPPLIES is the catch-all fallback. STAGES is
// reserved for AssetCategory=Studios — InventoryItems with "stage" in
// their name (e.g. "Fan - Stage 32"") are stage fans, not soundstages,
// and correctly land in GE or PRO_SUPPLIES.
// ─────────────────────────────────────────────────────────────────────────
const DEPT_PATTERNS: { pattern: RegExp; dept: LineItemDepartment }[] = [
  {
    dept: 'COMMUNICATIONS',
    pattern:
      /\b(radio|walkie|surveillance|comtek|headset|two[- ]?way|wireless|earpiece|intercom|shoulder mic|cp200)\b/i,
  },
  {
    dept: 'GE',
    pattern:
      /\b(sandbag|c[- ]?stand|grip|electric|generator|distro|cable|apple ?box|dimmer|gaffer|stinger|cardellini|flag|silk|bates|camlok|socapex|cheeseboro|fresnel|kino|tungsten|chimera|sumo|lens|frame|combo|stand)\b/i,
  },
  {
    dept: 'EXPENDABLES',
    pattern:
      /\b(tape|gel|foam|expendable|sharpie|gaff|black ?wrap|cinefoil|glove|battery|batteries|sandbag refill)\b/i,
  },
  {
    dept: 'ART',
    pattern: /\b(paint|prop|dressing|scenic|set ?dec|set dressing)\b/i,
  },
  {
    dept: 'PRO_SUPPLIES',
    pattern:
      /\b(chair|table|pad|blanket|cooler|trash|paper|folding|hand ?truck|dolly|cart|water|broom|mop|towel|safety vest|first aid|cone|d - rings|d-rings|grip clip|square corner|ratchet)\b/i,
  },
]

function inferDepartment(...textPieces: (string | null | undefined)[]): LineItemDepartment {
  const haystack = textPieces.filter(Boolean).join(' ')
  for (const { pattern, dept } of DEPT_PATTERNS) {
    if (pattern.test(haystack)) return dept
  }
  return 'PRO_SUPPLIES'
}

async function main() {
  console.log('🌱 Catalog aliases + department seed (Phase 2 sales pipeline)')

  // ── 1. AssetCategory: aliases + department ──────────────────────────
  const categories = await prisma.assetCategory.findMany({
    select: { id: true, slug: true, name: true },
  })
  let catUpdates = 0
  for (const c of categories) {
    const aliasPatch = ASSET_CATEGORY_ALIASES.find((p) => p.slug === c.slug)
    const department: LineItemDepartment = c.slug === 'studios' ? 'STAGES' : 'VEHICLES'
    await prisma.assetCategory.update({
      where: { id: c.id },
      data: {
        department,
        ...(aliasPatch ? { aliases: aliasPatch.aliases } : {}),
      },
    })
    catUpdates++
  }
  console.log(`   AssetCategory: ${catUpdates} rows updated (department + aliases where curated)`)

  // ── 2. InventoryItem: department keyword pass on every row ──────────
  const items = await prisma.inventoryItem.findMany({
    select: { id: true, code: true, description: true },
  })
  // Group by inferred department for a tally so we can sanity-check.
  const tally: Record<LineItemDepartment, number> = {
    VEHICLES: 0, COMMUNICATIONS: 0, STAGES: 0,
    PRO_SUPPLIES: 0, EXPENDABLES: 0, GE: 0, ART: 0,
  }
  for (const it of items) {
    const dept = inferDepartment(it.code, it.description)
    tally[dept]++
    await prisma.inventoryItem.update({
      where: { id: it.id },
      data: { department: dept },
    })
  }
  console.log(`   InventoryItem department tally:`)
  for (const [dept, n] of Object.entries(tally)) {
    if (n > 0) console.log(`     ${dept.padEnd(16)} ${n}`)
  }

  // ── 3. InventoryItem: curated aliases ──────────────────────────────
  let invAliasUpdates = 0
  for (const patch of INVENTORY_ALIASES) {
    const matches = await prisma.inventoryItem.findMany({
      where: { code: { contains: patch.codeContains, mode: 'insensitive' } },
      select: { id: true, code: true },
    })
    if (matches.length === 0) {
      console.warn(`   ⚠ no match for codeContains="${patch.codeContains}" — skipped`)
      continue
    }
    for (const m of matches) {
      await prisma.inventoryItem.update({
        where: { id: m.id },
        data: { aliases: patch.aliases },
      })
      invAliasUpdates++
    }
  }
  console.log(`   InventoryItem: ${invAliasUpdates} rows received curated aliases`)

  // ── 4. Tighten department to NOT NULL on both tables ───────────────
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "inventory_items" ALTER COLUMN "department" SET NOT NULL`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "asset_categories" ALTER COLUMN "department" SET NOT NULL`
  )
  console.log('   Tightened department to NOT NULL on both tables.')

  await prisma.$disconnect()
  console.log('✓ Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
