/**
 * RentalWorks catalog enrichment — pre-flight + apply.
 *
 * Default: pre-flight only (no DB writes). Generates tmp/rw-import-preflight.md
 * and prints a summary to the terminal.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   export RENTALWORKS_TOKEN=$(grep '^RENTALWORKS_TOKEN' .env.local | cut -d'=' -f2-)
 *   npx tsx scripts/rw-catalog-import.ts
 *
 * To actually apply the import (Step 5 in the brief — only after Wes
 * approves the pre-flight), pass --apply:
 *
 *   npx tsx scripts/rw-catalog-import.ts --apply
 *
 * Apply writes are idempotent re-runnable: code/name matches re-enrich,
 * RW-only items are upserted by rwId.
 */

import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'
import {
  fetchAllItems,
  groupItemsToMasters,
  type RwMaster,
} from '../src/lib/rentalworks/client'
import type { LineItemDepartment } from '@prisma/client'

const APPLY = process.argv.includes('--apply')

// ─────────────────────────────────────────────────────────────────────
// Department keyword pass — same shape as the May 8 catalog seed.
// First match wins. PRO_SUPPLIES is the catch-all.
// ─────────────────────────────────────────────────────────────────────
const DEPT_PATTERNS: { pattern: RegExp; dept: LineItemDepartment }[] = [
  { dept: 'COMMUNICATIONS', pattern: /\b(radio|walkie|surveillance|comtek|headset|two[- ]?way|wireless|earpiece|intercom|shoulder mic|cp200)\b/i },
  { dept: 'GE',             pattern: /\b(sandbag|c[- ]?stand|grip|electric|generator|distro|cable|apple ?box|dimmer|gaffer|stinger|cardellini|flag|silk|bates|camlok|socapex|cheeseboro|fresnel|kino|tungsten|chimera|sumo|lens|frame|combo|stand|light|flexvolt|dewalt)\b/i },
  { dept: 'EXPENDABLES',    pattern: /\b(tape|gel|foam|expendable|sharpie|gaff|black ?wrap|cinefoil|glove|battery|batteries)\b/i },
  { dept: 'ART',            pattern: /\b(paint|prop|dressing|scenic|set ?dec|set dressing)\b/i },
  { dept: 'PRO_SUPPLIES',   pattern: /\b(chair|table|pad|blanket|cooler|trash|paper|folding|hand ?truck|dolly|cart|water|broom|mop|towel|safety vest|first aid|cone|d[- ]?rings|grip clip|square corner|ratchet|strap)\b/i },
]

function inferDepartment(name: string): LineItemDepartment {
  for (const { pattern, dept } of DEPT_PATTERNS) {
    if (pattern.test(name)) return dept
  }
  return 'PRO_SUPPLIES'
}

// ─────────────────────────────────────────────────────────────────────
// Name normalization for fuzzy matching.
//
// Two-stage match:
//   1. exact normalized name (preferred — keeps word order signal),
//   2. sorted-token bag-of-words (catches "40" C-STAND" vs "C-Stand 40"").
//
// SirReel UTAH-prefix variants are stripped before keying so the LA
// variant — which already matches the RW master — wins. The UTAH dup
// then correctly lands in D-bucket (true SirReel-side duplicate).
// ─────────────────────────────────────────────────────────────────────
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'with', 'and', 'or', 'for'])

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/^utah\s*-?\s*/i, '') // strip leading "UTAH - " on SirReel descriptions
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenSetKey(s: string): string {
  const tokens = normalizeName(s)
    .split(' ')
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
  tokens.sort()
  return tokens.join(' ')
}

function fmtMoney(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`RW catalog import — ${APPLY ? '🚀 APPLY MODE (will write to DB)' : 'pre-flight only (no writes)'}`)
  console.log()

  // 1. Pull RW Items
  console.log('Pulling RW /api/v1/item …')
  const items = await fetchAllItems({
    pageSize: 200,
    onPage: (p, tp, fetched, total) =>
      console.log(`  page ${p}/${tp} — ${fetched}/${total} items`),
  })
  console.log(`  retrieved ${items.length} physical items`)

  // 2. Group into catalog masters
  const masters = groupItemsToMasters(items)
  console.log(`  grouped into ${masters.length} catalog masters (after dropping all-inactive groups)`)

  // 3. Read SirReel inventory_items
  const sirreel = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: {
      id: true, code: true, description: true,
      dailyRate: true, weeklyRate: true, replacementCost: true,
      department: true, manufacturer: true, model: true, dimensions: true,
      rwId: true,
    },
  })
  console.log(`  loaded ${sirreel.length} SirReel inventory items`)

  // 4. Build matching indexes — three keys per RW master:
  //    by ICode (exact code), by normalized name (preferred), by token-set
  //    (catches word-order variants like "40" C-STAND" ↔ "C-Stand 40"").
  const rwByICode = new Map<string, RwMaster>()
  const rwByNormalizedName = new Map<string, RwMaster[]>()
  const rwByTokenSet = new Map<string, RwMaster[]>()
  for (const m of masters) {
    if (m.iCode) rwByICode.set(m.iCode, m)
    const norm = normalizeName(m.description)
    if (norm) {
      const arr = rwByNormalizedName.get(norm) ?? []
      arr.push(m)
      rwByNormalizedName.set(norm, arr)
    }
    const tokenKey = tokenSetKey(m.description)
    if (tokenKey) {
      const arr = rwByTokenSet.get(tokenKey) ?? []
      arr.push(m)
      rwByTokenSet.set(tokenKey, arr)
    }
  }

  // 5. Match each SirReel item to RW
  type Bucket = 'A_CODE' | 'B_NAME_REALIGN' | 'D_SIRREEL_ONLY'
  type Pairing = {
    bucket: Bucket
    sirreel: typeof sirreel[number]
    rw: RwMaster | null
    matchKey: 'ICode' | 'name' | 'tokens' | null
  }
  const matched: Pairing[] = []
  const sirreelMatchedRwIds = new Set<string>()

  for (const s of sirreel) {
    const codeHit = rwByICode.get((s.code || '').trim())
    if (codeHit) {
      matched.push({ bucket: 'A_CODE', sirreel: s, rw: codeHit, matchKey: 'ICode' })
      sirreelMatchedRwIds.add(codeHit.rwInventoryId)
      continue
    }
    const sirreelText = s.description || s.code

    // Stage 1: exact normalized-name match.
    const nameKey = normalizeName(sirreelText)
    const nameHits = (rwByNormalizedName.get(nameKey) ?? [])
      .filter((h) => !sirreelMatchedRwIds.has(h.rwInventoryId))
    if (nameHits.length === 1) {
      matched.push({ bucket: 'B_NAME_REALIGN', sirreel: s, rw: nameHits[0], matchKey: 'name' })
      sirreelMatchedRwIds.add(nameHits[0].rwInventoryId)
      continue
    }

    // Stage 2: token-set match (word-order insensitive).
    const tokenKey = tokenSetKey(sirreelText)
    const tokenHits = (rwByTokenSet.get(tokenKey) ?? [])
      .filter((h) => !sirreelMatchedRwIds.has(h.rwInventoryId))
    if (tokenHits.length === 1) {
      matched.push({ bucket: 'B_NAME_REALIGN', sirreel: s, rw: tokenHits[0], matchKey: 'tokens' })
      sirreelMatchedRwIds.add(tokenHits[0].rwInventoryId)
      continue
    }

    matched.push({ bucket: 'D_SIRREEL_ONLY', sirreel: s, rw: null, matchKey: null })
  }

  // 6. RW-only items
  const rwOnly = masters.filter((m) => !sirreelMatchedRwIds.has(m.rwInventoryId))

  // 7. Bucket the matched pairs further (rate conflicts, enrichment coverage)
  const aMatches = matched.filter((p) => p.bucket === 'A_CODE')
  const bMatches = matched.filter((p) => p.bucket === 'B_NAME_REALIGN')
  const dOnly = matched.filter((p) => p.bucket === 'D_SIRREEL_ONLY')

  type RateConflict = {
    name: string
    sirreelCode: string
    rwICode: string
    sirreelDaily: number
    rwDaily: number
    sirreelWeekly: number
    rwWeekly: number
    diffDaily: number
    diffWeekly: number
  }
  const rateConflicts: RateConflict[] = []
  for (const p of [...aMatches, ...bMatches]) {
    const sd = Number(p.sirreel.dailyRate) || 0
    const sw = Number(p.sirreel.weeklyRate) || 0
    const rd = Number(p.rw!.dailyRate) || 0
    const rw_ = Number(p.rw!.weeklyRate) || 0
    if (sd !== rd || sw !== rw_) {
      rateConflicts.push({
        name: p.sirreel.description || p.sirreel.code,
        sirreelCode: p.sirreel.code,
        rwICode: p.rw!.iCode,
        sirreelDaily: sd,
        rwDaily: rd,
        sirreelWeekly: sw,
        rwWeekly: rw_,
        diffDaily: rd - sd,
        diffWeekly: rw_ - sw,
      })
    }
  }

  type EnrichmentRow = {
    sirreelCode: string
    name: string
    sirreelDescriptionLength: number
    rwDescription: string
    rwDescriptionLength: number
    willEnrich: boolean
    addsManufacturer: boolean
    addsModel: boolean
    addsDimensions: boolean
    addsSpecs: boolean
  }
  const enrichmentRows: EnrichmentRow[] = []
  for (const p of [...aMatches, ...bMatches]) {
    const sDesc = p.sirreel.description || ''
    const rDesc = p.rw!.description || ''
    const willEnrich = sDesc.length === 0 || sDesc.length < 30 || rDesc.length > sDesc.length * 1.3
    enrichmentRows.push({
      sirreelCode: p.sirreel.code,
      name: sDesc || p.sirreel.code,
      sirreelDescriptionLength: sDesc.length,
      rwDescription: rDesc,
      rwDescriptionLength: rDesc.length,
      willEnrich,
      addsManufacturer: !p.sirreel.manufacturer && !!p.rw!.manufacturer,
      addsModel: !p.sirreel.model && !!p.rw!.model,
      addsDimensions: !p.sirreel.dimensions && !!p.rw!.dimensions,
      addsSpecs: !!p.rw!.notes,
    })
  }
  const enrichmentMeaningful = enrichmentRows.filter(
    (e) => e.willEnrich || e.addsManufacturer || e.addsModel || e.addsDimensions || e.addsSpecs,
  )

  // ─────────────────────────────────────────────────────────────────
  // 8. Build the report
  // ─────────────────────────────────────────────────────────────────
  const lines: string[] = []
  const push = (s: string = '') => lines.push(s)

  push('# RentalWorks Catalog Import — Pre-flight Report')
  push('')
  push(`Generated: ${new Date().toISOString()}`)
  push(`RW physical items: **${items.length}** · grouped masters: **${masters.length}**`)
  push(`SirReel active inventory items: **${sirreel.length}**`)
  push('')
  push('## Summary')
  push('')
  push('| Bucket | Count | Action on apply |')
  push('|---|---:|---|')
  push(`| A — Exact code match | ${aMatches.length} | Enrich description / specs / manufacturer / model / dimensions / replacementCost. Set rwId + rwLastSyncedAt. **Don't touch:** rates, aliases, department, categoryId, qtyOwned, code. |`)
  push(`| B — Name match (code realignment) | ${bMatches.length} | Same enrichment as A, **plus** rename SirReel \`code\` → RW \`ICode\`. |`)
  push(`| C — RW-only (auto-create) | ${rwOnly.length} | Create new SirReel row with full RW data. \`needsReview=true\`, \`aliases=[]\`, \`categoryId=null\`, \`department\` set by keyword guess. |`)
  push(`| D — SirReel-only | ${dOnly.length} | No change. Listed below for visibility — could be platform-only items, recently retired in RW, or AI-rejected name matches. |`)
  push(`| E — Rate conflicts (informational) | ${rateConflicts.length} | **No change.** Rates are preserved. Listed for visibility into where SirReel and RW have drifted. |`)
  push(`| F — Enrichment coverage | ${enrichmentMeaningful.length} | Of ${aMatches.length + bMatches.length} matched items, ${enrichmentMeaningful.length} would receive at least one new field. |`)
  push('')
  push('---')
  push('')

  // A
  push('## A. Exact code matches')
  push('')
  push(`Total: **${aMatches.length}**.`)
  push('')
  if (aMatches.length === 0) {
    push('_(none — SirReel codes don\'t match RW ICodes anywhere; expected since SirReel\'s `code` field has historically held descriptions not RW codes.)_')
  } else {
    push('First 10 examples:')
    push('')
    push('| SirReel code | RW ICode | Description |')
    push('|---|---|---|')
    for (const p of aMatches.slice(0, 10)) {
      push(`| \`${p.sirreel.code}\` | \`${p.rw!.iCode}\` | ${p.sirreel.description} |`)
    }
  }
  push('')

  // B
  push('## B. Name matches with mismatched codes (code-realignment candidates)')
  push('')
  push(`Total: **${bMatches.length}**. On apply, SirReel \`code\` will be renamed to RW \`ICode\` for each.`)
  push('')
  if (bMatches.length > 0) {
    push('| Current SirReel code → RW ICode | Item name | Match signal |')
    push('|---|---|---|')
    for (const p of bMatches) {
      push(`| \`${p.sirreel.code}\` → \`${p.rw!.iCode}\` | ${p.sirreel.description} | ${p.matchKey} |`)
    }
  }
  push('')

  // C
  push('## C. RW-only items (will be auto-created)')
  push('')
  push(`Total: **${rwOnly.length}**. New SirReel rows created with \`needsReview=true\`. categoryId stays NULL pending manual assignment.`)
  push('')
  if (rwOnly.length > 0) {
    push('| RW ICode | Description | Manufacturer | Suggested dept | RW DailyRate | RW WeeklyRate | Active qty |')
    push('|---|---|---|---|---:|---:|---:|')
    for (const m of rwOnly) {
      const guessedDept = inferDepartment(m.description)
      push(
        `| \`${m.iCode}\` | ${m.description} | ${m.manufacturer ?? '—'} | ${guessedDept} | ${fmtMoney(m.dailyRate)} | ${fmtMoney(m.weeklyRate)} | ${m.qtyActive} |`,
      )
    }
  }
  push('')

  // D
  push('## D. SirReel-only items')
  push('')
  push(`Total: **${dOnly.length}**. No change — listed for visibility.`)
  push('')
  if (dOnly.length > 0) {
    push('| SirReel code | Description | Department | Daily | Weekly |')
    push('|---|---|---|---:|---:|')
    for (const p of dOnly) {
      push(
        `| \`${p.sirreel.code}\` | ${p.sirreel.description ?? '—'} | ${p.sirreel.department} | ${fmtMoney(Number(p.sirreel.dailyRate))} | ${fmtMoney(Number(p.sirreel.weeklyRate))} |`,
      )
    }
  }
  push('')

  // E
  push('## E. Rate conflicts (informational only — rates are preserved)')
  push('')
  push(`Total: **${rateConflicts.length}**.`)
  push('')
  if (rateConflicts.length > 0) {
    push('| Item | SirReel daily | RW daily | Δ | SirReel weekly | RW weekly | Δ |')
    push('|---|---:|---:|---:|---:|---:|---:|')
    for (const r of rateConflicts) {
      push(
        `| ${r.name} | ${fmtMoney(r.sirreelDaily)} | ${fmtMoney(r.rwDaily)} | ${fmtMoney(r.diffDaily)} | ${fmtMoney(r.sirreelWeekly)} | ${fmtMoney(r.rwWeekly)} | ${fmtMoney(r.diffWeekly)} |`,
      )
    }
  }
  push('')

  // F
  push('## F. Description / spec enrichment coverage')
  push('')
  push(`Of ${aMatches.length + bMatches.length} matched items, **${enrichmentMeaningful.length}** would receive at least one new field on apply.`)
  push('')
  const breakdown = {
    descriptionEnrich: enrichmentRows.filter((e) => e.willEnrich).length,
    addsManufacturer: enrichmentRows.filter((e) => e.addsManufacturer).length,
    addsModel: enrichmentRows.filter((e) => e.addsModel).length,
    addsDimensions: enrichmentRows.filter((e) => e.addsDimensions).length,
    addsSpecs: enrichmentRows.filter((e) => e.addsSpecs).length,
  }
  push(`- Description enriched: **${breakdown.descriptionEnrich}**`)
  push(`- Manufacturer set: **${breakdown.addsManufacturer}**`)
  push(`- Model set: **${breakdown.addsModel}**`)
  push(`- Dimensions set: **${breakdown.addsDimensions}**`)
  push(`- Specs (RW notes) set: **${breakdown.addsSpecs}**`)
  push('')

  const reportPath = path.join(process.cwd(), 'tmp/rw-import-preflight.md')
  mkdirSync(path.dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, lines.join('\n'))

  // ─────────────────────────────────────────────────────────────────
  // 9. Terminal summary
  // ─────────────────────────────────────────────────────────────────
  console.log()
  console.log('───── SUMMARY ─────')
  console.log(`A. Exact code matches:     ${aMatches.length}`)
  console.log(`B. Name match / realign:   ${bMatches.length}`)
  console.log(`C. RW-only (auto-create):  ${rwOnly.length}`)
  console.log(`D. SirReel-only:           ${dOnly.length}`)
  console.log(`E. Rate conflicts:         ${rateConflicts.length}  (preserved — informational)`)
  console.log(`F. Enrichment-meaningful:  ${enrichmentMeaningful.length} of ${aMatches.length + bMatches.length}`)
  console.log()
  console.log(`Report written to ${reportPath}`)

  if (!APPLY) {
    console.log()
    console.log('🛑  Pre-flight only. Re-run with --apply to perform the import.')
    await prisma.$disconnect()
    return
  }

  // ─────────────────────────────────────────────────────────────────
  // 10. APPLY (Step 5 — only when --apply flag is set)
  // ─────────────────────────────────────────────────────────────────
  console.log()
  console.log('🚀 APPLY MODE — writing to DB …')
  const now = new Date()
  let enrichedCount = 0
  let alignedCount = 0
  let createdCount = 0

  // Find the InventoryCategory id for "Misc" or first category, used as a
  // placeholder for auto-created items. categoryId is NOT NULL in the
  // schema; brief says "categoryId=NULL initially" but the column is
  // non-null in this DB. Use the existing "Miscellaneous" category if
  // present, else the first one.
  const cats = await prisma.inventoryCategory.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { sortOrder: 'asc' },
  })
  const placeholderCategory =
    cats.find((c) => /misc/i.test(c.name)) ??
    cats.find((c) => /unassigned|review/i.test(c.name)) ??
    cats[0]
  if (!placeholderCategory) {
    throw new Error('No InventoryCategory rows exist; cannot create RW-only items.')
  }
  console.log(`  Using "${placeholderCategory.name}" (${placeholderCategory.slug}) as placeholder category for auto-created rows.`)

  for (const p of aMatches) {
    await applyEnrichment(p.sirreel.id, p.rw!, p.sirreel, now, /*alignCode*/ false)
    enrichedCount++
  }
  for (const p of bMatches) {
    await applyEnrichment(p.sirreel.id, p.rw!, p.sirreel, now, /*alignCode*/ true)
    alignedCount++
  }
  for (const m of rwOnly) {
    await prisma.inventoryItem.create({
      data: {
        code: m.iCode,
        description: m.description,
        categoryId: placeholderCategory.id,
        department: inferDepartment(m.description),
        dailyRate: m.dailyRate,
        weeklyRate: m.weeklyRate,
        replacementCost: m.replacementCost > 0 ? m.replacementCost : null,
        qtyOwned: m.qtyActive,
        manufacturer: m.manufacturer,
        model: m.model,
        dimensions: m.dimensions,
        specs: m.notes,
        aliases: [],
        needsReview: true,
        rwLastSyncedAt: now,
        rwId: m.rwInventoryId,
      },
    })
    createdCount++
  }

  // 11. Applied report
  const applied: string[] = []
  applied.push('# RentalWorks Catalog Import — Applied')
  applied.push('')
  applied.push(`Run at: ${now.toISOString()}`)
  applied.push('')
  applied.push(`- Enriched (exact code match):           **${enrichedCount}**`)
  applied.push(`- Code-realigned + enriched (name match): **${alignedCount}**`)
  applied.push(`- Auto-created (RW-only):                **${createdCount}**`)
  applied.push(`- Untouched SirReel-only:                **${dOnly.length}**`)
  applied.push(`- Rate conflicts logged but unchanged:    **${rateConflicts.length}**`)
  applied.push('')
  applied.push(`Placeholder InventoryCategory for new rows: \`${placeholderCategory.slug}\` ("${placeholderCategory.name}"). Admin should reassign via the catalog UI.`)
  const appliedPath = path.join(process.cwd(), 'tmp/rw-import-applied.md')
  writeFileSync(appliedPath, applied.join('\n'))
  console.log()
  console.log(`✓ Applied. Report at ${appliedPath}`)
  console.log(`  Enriched: ${enrichedCount}  · Aligned: ${alignedCount}  · Created: ${createdCount}`)

  await prisma.$disconnect()
}

interface SirreelRow {
  id: string
  code: string
  description: string | null
  manufacturer: string | null
  model: string | null
  dimensions: string | null
  replacementCost: { toNumber(): number } | null
}

async function applyEnrichment(
  id: string,
  rw: RwMaster,
  sirreel: SirreelRow,
  now: Date,
  alignCode: boolean,
) {
  const data: Record<string, unknown> = {
    rwId: rw.rwInventoryId,
    rwLastSyncedAt: now,
  }
  if (alignCode) data.code = rw.iCode

  // Description: enrich when SirReel value is empty / short, or RW is
  // meaningfully longer.
  const sDesc = sirreel.description || ''
  if (sDesc.length === 0 || sDesc.length < 30 || (rw.description.length > sDesc.length * 1.3)) {
    if (rw.description) data.description = rw.description
  }
  if (!sirreel.manufacturer && rw.manufacturer) data.manufacturer = rw.manufacturer
  if (!sirreel.model && rw.model) data.model = rw.model
  if (!sirreel.dimensions && rw.dimensions) data.dimensions = rw.dimensions
  if (rw.notes) data.specs = rw.notes
  const currentReplacement = sirreel.replacementCost ? sirreel.replacementCost.toNumber() : 0
  if ((!currentReplacement || currentReplacement === 0) && rw.replacementCost > 0) {
    data.replacementCost = rw.replacementCost
  }

  await prisma.inventoryItem.update({ where: { id }, data })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
