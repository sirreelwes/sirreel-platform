/**
 * 2026-06-23 — One-time RentalWorks ↔ HQ inventory reconcile.
 *
 * Lines up HQ InventoryItem against RentalWorks (the reference source
 * being retired) to (a) backfill the RW item number (I-Code) into the
 * new `InventoryItem.rwICode` column and (b) safe-fill missing pricing.
 * Produces a reconciliation report (markdown + CSV). NOT a route, NOT a
 * cron — a one-shot enrichment. Native-first still holds.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   export RENTALWORKS_TOKEN=$(grep '^RENTALWORKS_TOKEN' .env.local | cut -d'=' -f2-)
 *   npx tsx prisma/seeds/2026-06-23-rw-inventory-reconcile.ts            # PREFLIGHT (no writes)
 *   npx tsx prisma/seeds/2026-06-23-rw-inventory-reconcile.ts --apply    # write pass
 *
 * SAFETY CONTRACT (verified, see e40603f): OrderLineItem.rate is a
 * snapshot persisted at line-create time; computeLineTotal() reads the
 * stored line rate and never touches InventoryItem. Backfilling catalog
 * rates here CANNOT move any existing order/quote/invoice total.
 *
 * WRITE RULES (only on MATCHED rows, only with --apply):
 *   - I-Code: set rwICode where it's null. NEVER overwrite an existing
 *     rwICode; if RW disagrees with an existing one, it's an ICODE-CONFLICT
 *     (report only).
 *   - Pricing (OPTION A — safe-fill): fill dailyRate/weeklyRate only where
 *     HQ is 0. Where BOTH have a value and they differ → PRICE-CONFLICT
 *     (report only, never written). [Option B = RW always wins: change the
 *     `fillDaily/fillWeekly` decision below to overwrite on conflict and
 *     keep routing through RateChangeLog.] HQ has no monthlyRate column,
 *     so RW monthly is reported but not written.
 *   - Every rate change is audited via RateChangeLog(source=IMPORT_RW).
 *
 * IDEMPOTENT: re-running fills nothing already filled (rwICode non-null is
 * skipped; dailyRate/weeklyRate already >0 is skipped) and writes no
 * RateChangeLog when no rate actually changes.
 */

import { writeFileSync } from 'fs'
import { prisma } from '../../src/lib/prisma'
import { fetchAllItems, groupItemsToMasters, type RwMaster } from '../../src/lib/rentalworks/client'

const APPLY = process.argv.includes('--apply')
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'with', 'and', 'or', 'for'])

function normalizeName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^utah\s*-?\s*/i, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function tokenSetKey(s: string): string {
  const t = normalizeName(s).split(' ').filter((x) => x.length > 0 && !STOPWORDS.has(x))
  t.sort()
  return t.join(' ')
}
const num = (v: unknown) => Number(v ?? 0) || 0
const money = (n: number | null | undefined) => (n == null ? '—' : `$${Number(n).toFixed(2)}`)

type MatchType = 'MATCHED' | 'FUZZY' | 'HQ-ONLY'
type MatchMethod = 'rwId' | 'name' | 'tokens' | null

interface Row {
  matchType: MatchType
  method: MatchMethod
  hqId: string
  hqName: string
  hqDaily: number
  hqWeekly: number
  hqReplacement: number | null
  hqRwICode: string | null
  rw: RwMaster | null
  fuzzyCandidates?: RwMaster[]
  icodeAction: 'backfill' | 'have' | 'CONFLICT' | 'n/a'
  priceAction: string
  priceConflict: boolean
}

async function main() {
  console.log(`\n=== RW ↔ HQ inventory reconcile — ${APPLY ? 'APPLY (writes ON)' : 'PREFLIGHT (no writes)'} ===\n`)

  // ── PULL all RW items (full pagination) ──────────────────────────
  let rwItems
  try {
    rwItems = await fetchAllItems({
      onPage: (p, tp, fetched, total) => console.log(`  RW pull: page ${p}/${tp} — ${fetched}/${total}`),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/401|403/.test(msg)) {
      console.error('\n!! RW auth rejected mid-pull (token expired). No programmatic login is wired —')
      console.error('   rotate RENTALWORKS_TOKEN via the RW admin UI (docs/runbooks/rentalworks-token-rotation.md)')
      console.error('   and re-run. Aborting with NO writes.')
    } else {
      console.error('\n!! RW pull failed:', msg)
    }
    await prisma.$disconnect()
    process.exit(2)
  }
  const masters = groupItemsToMasters(rwItems)
  console.log(`  RW: ${rwItems.length} items → ${masters.length} masters (one per InventoryId, active units only)\n`)

  // ── RW indexes ───────────────────────────────────────────────────
  const byRwId = new Map<string, RwMaster>()
  const byName = new Map<string, RwMaster[]>()
  const byTokens = new Map<string, RwMaster[]>()
  for (const m of masters) {
    byRwId.set(m.rwInventoryId, m)
    const n = normalizeName(m.description)
    if (n) (byName.get(n) ?? byName.set(n, []).get(n)!).push(m)
    const t = tokenSetKey(m.description)
    if (t) (byTokens.get(t) ?? byTokens.set(t, []).get(t)!).push(m)
  }

  // ── HQ active items ──────────────────────────────────────────────
  const hq = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: { id: true, code: true, description: true, dailyRate: true, weeklyRate: true, replacementCost: true, rwId: true, rwICode: true },
  })
  console.log(`  HQ: ${hq.length} active items\n`)

  const rows: Row[] = []
  const seenRwIds = new Set<string>() // RW masters that some HQ item references → not RW-ONLY

  for (const item of hq) {
    const hqName = item.description?.trim() || item.code
    const base = {
      hqId: item.id, hqName,
      hqDaily: num(item.dailyRate), hqWeekly: num(item.weeklyRate),
      hqReplacement: item.replacementCost == null ? null : num(item.replacementCost),
      hqRwICode: item.rwICode,
    }

    // 1. rwId-exact (the canonical RW link from the May import)
    let rw: RwMaster | null = null
    let method: MatchMethod = null
    let matchType: MatchType = 'HQ-ONLY'
    let fuzzy: RwMaster[] | undefined

    if (item.rwId && byRwId.has(item.rwId)) {
      rw = byRwId.get(item.rwId)!; method = 'rwId'; matchType = 'MATCHED'
    } else {
      const nameKey = normalizeName(hqName)
      const nameHits = byName.get(nameKey) ?? []
      if (nameHits.length === 1) { rw = nameHits[0]; method = 'name'; matchType = 'MATCHED' }
      else if (nameHits.length > 1) { fuzzy = nameHits; method = 'name'; matchType = 'FUZZY' }
      else {
        const tokHits = byTokens.get(tokenSetKey(hqName)) ?? []
        if (tokHits.length >= 1) { fuzzy = tokHits; method = 'tokens'; matchType = 'FUZZY' }
      }
    }

    if (rw) seenRwIds.add(rw.rwInventoryId)
    if (fuzzy) for (const c of fuzzy) seenRwIds.add(c.rwInventoryId)

    // I-Code action (MATCHED only)
    let icodeAction: Row['icodeAction'] = 'n/a'
    if (matchType === 'MATCHED' && rw) {
      if (!item.rwICode) icodeAction = rw.iCode ? 'backfill' : 'n/a'
      else if (item.rwICode === rw.iCode) icodeAction = 'have'
      else icodeAction = 'CONFLICT'
    }

    // Price action — OPTION A safe-fill (MATCHED only)
    let priceAction = 'n/a'
    let priceConflict = false
    if (matchType === 'MATCHED' && rw) {
      const acts: string[] = []
      // daily
      if (base.hqDaily === 0 && rw.dailyRate > 0) acts.push('fill-daily')
      else if (base.hqDaily > 0 && rw.dailyRate > 0 && Math.abs(base.hqDaily - rw.dailyRate) >= 0.005) { acts.push('CONFLICT-daily'); priceConflict = true }
      // weekly
      if (base.hqWeekly === 0 && rw.weeklyRate > 0) acts.push('fill-weekly')
      else if (base.hqWeekly > 0 && rw.weeklyRate > 0 && Math.abs(base.hqWeekly - rw.weeklyRate) >= 0.005) { acts.push('CONFLICT-weekly'); priceConflict = true }
      priceAction = acts.length ? acts.join(',') : 'noop'
    }

    rows.push({ matchType, method, ...base, rw, fuzzyCandidates: fuzzy, icodeAction, priceAction, priceConflict })
  }

  // RW-ONLY = masters no HQ item referenced
  const rwOnly = masters.filter((m) => !seenRwIds.has(m.rwInventoryId))

  // ── Buckets ──────────────────────────────────────────────────────
  const matched = rows.filter((r) => r.matchType === 'MATCHED')
  const fuzzyRows = rows.filter((r) => r.matchType === 'FUZZY')
  const hqOnly = rows.filter((r) => r.matchType === 'HQ-ONLY')
  const icodeBackfills = matched.filter((r) => r.icodeAction === 'backfill')
  const icodeConflicts = matched.filter((r) => r.icodeAction === 'CONFLICT')
  const priceFills = matched.filter((r) => /fill-/.test(r.priceAction))
  const priceConflicts = matched.filter((r) => r.priceConflict)

  // ── APPLY (writes) — MATCHED rows only ───────────────────────────
  let icodesWritten = 0, pricesWritten = 0, auditRows = 0
  if (APPLY) {
    const wes = await prisma.user.findFirst({ where: { email: { equals: 'wes@sirreel.com', mode: 'insensitive' } }, select: { id: true } })
    const appliedById = wes?.id ?? null
    const now = new Date()
    for (const r of matched) {
      if (!r.rw) continue
      const data: Record<string, unknown> = {}
      // I-Code backfill (never overwrite)
      if (r.icodeAction === 'backfill') data.rwICode = r.rw.iCode
      // safe-fill prices (only where HQ is 0; never on conflict)
      const newDaily = r.hqDaily === 0 && r.rw.dailyRate > 0 ? r.rw.dailyRate : r.hqDaily
      const newWeekly = r.hqWeekly === 0 && r.rw.weeklyRate > 0 ? r.rw.weeklyRate : r.hqWeekly
      const rateChanged = newDaily !== r.hqDaily || newWeekly !== r.hqWeekly
      if (rateChanged) { data.dailyRate = newDaily; data.weeklyRate = newWeekly }
      // stamp rwId when matched by name/tokens (closes the linkage gap)
      if (r.method !== 'rwId') data.rwId = r.rw.rwInventoryId
      if (rateChanged || data.rwICode !== undefined || data.rwId !== undefined) data.rwLastSyncedAt = now
      if (Object.keys(data).length === 0) continue

      const updateOp = prisma.inventoryItem.update({ where: { id: r.hqId }, data })
      if (rateChanged) {
        // Atomic: the rate fill and its audit row can't drift.
        await prisma.$transaction([
          updateOp,
          prisma.rateChangeLog.create({
            data: {
              inventoryItemId: r.hqId,
              oldDailyRate: r.hqDaily, newDailyRate: newDaily,
              oldWeeklyRate: r.hqWeekly, newWeeklyRate: newWeekly,
              source: 'IMPORT_RW', rwIdSource: r.rw.rwInventoryId, matchMethod: r.method,
              appliedById, appliedAt: now,
            },
          }),
        ])
      } else {
        await updateOp
      }
      if (data.rwICode !== undefined) icodesWritten++
      if (rateChanged) { pricesWritten++; auditRows++ }
    }
  }

  // ── Reports ──────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const csvPath = `/tmp/rw-inventory-reconcile-${stamp}.csv`
  const mdPath = `/tmp/rw-inventory-reconcile-${stamp}.md`
  const esc = (s: unknown) => { const v = String(s ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v }

  const csv: string[] = ['rw_icode,rw_name,hq_id,hq_name,match_type,icode_action,price_action,rw_daily,hq_daily,rw_weekly,hq_weekly,conflict_flag']
  for (const r of rows) {
    csv.push([esc(r.rw?.iCode ?? ''), esc(r.rw?.description ?? (r.fuzzyCandidates?.map((c) => c.iCode).join('|') ?? '')), esc(r.hqId), esc(r.hqName),
      r.matchType, r.icodeAction, esc(r.priceAction), r.rw?.dailyRate ?? '', r.hqDaily, r.rw?.weeklyRate ?? '', r.hqWeekly,
      r.priceConflict ? 'PRICE' : (r.icodeAction === 'CONFLICT' ? 'ICODE' : '')].join(','))
  }
  for (const m of rwOnly) csv.push([esc(m.iCode), esc(m.description), '', '', 'RW-ONLY', 'n/a', 'n/a', m.dailyRate, '', m.weeklyRate, '', ''].join(','))
  writeFileSync(csvPath, csv.join('\n'))

  const md: string[] = []
  md.push(`# RW ↔ HQ inventory reconcile — ${APPLY ? 'APPLIED' : 'PREFLIGHT'} — ${new Date().toISOString()}`)
  md.push(`\n## Bucket counts`)
  md.push(`| bucket | count |`, `|---|---|`)
  md.push(`| MATCHED | ${matched.length} |`, `| FUZZY (needs review) | ${fuzzyRows.length} |`, `| RW-ONLY (report only) | ${rwOnly.length} |`, `| HQ-ONLY (report only) | ${hqOnly.length} |`)
  md.push(`\n**Actions** — I-Codes backfillable: ${icodeBackfills.length} · prices fillable: ${priceFills.length} · PRICE-CONFLICTS: ${priceConflicts.length} · ICODE-CONFLICTS: ${icodeConflicts.length}`)
  if (APPLY) md.push(`\n**WRITTEN** — rwICode set: ${icodesWritten} · prices filled: ${pricesWritten} · RateChangeLog(IMPORT_RW) rows: ${auditRows}`)

  md.push(`\n## PRICE-CONFLICTS (both have a value, they differ — NOT written)`)
  if (priceConflicts.length === 0) md.push(`_none_`)
  else { md.push(`| hq_name | rw_icode | hq_daily | rw_daily | hq_weekly | rw_weekly |`, `|---|---|---|---|---|---|`)
    for (const r of priceConflicts) md.push(`| ${r.hqName} | ${r.rw?.iCode} | ${money(r.hqDaily)} | ${money(r.rw?.dailyRate)} | ${money(r.hqWeekly)} | ${money(r.rw?.weeklyRate)} |`) }

  md.push(`\n## ICODE-CONFLICTS (HQ already has a different I-Code — NOT overwritten)`)
  if (icodeConflicts.length === 0) md.push(`_none_`)
  else { md.push(`| hq_name | hq_rwICode | rw_iCode |`, `|---|---|---|`)
    for (const r of icodeConflicts) md.push(`| ${r.hqName} | ${r.hqRwICode} | ${r.rw?.iCode} |`) }

  md.push(`\n## FUZZY (near/ambiguous name — propose, NOT auto-linked)`)
  if (fuzzyRows.length === 0) md.push(`_none_`)
  else { md.push(`| hq_name | method | candidate RW (iCode · desc · $daily) |`, `|---|---|---|`)
    for (const r of fuzzyRows) md.push(`| ${r.hqName} | ${r.method} | ${(r.fuzzyCandidates ?? []).slice(0, 4).map((c) => `${c.iCode} · ${c.description} · ${money(c.dailyRate)}`).join(' ⟂ ')} |`) }

  md.push(`\n## RW-ONLY (in RW, not in HQ — report only, NOT auto-created) — ${rwOnly.length}`)
  for (const m of rwOnly.slice(0, 40)) md.push(`- ${m.iCode} · ${m.description} · ${money(m.dailyRate)}/d`)
  if (rwOnly.length > 40) md.push(`- …and ${rwOnly.length - 40} more (see CSV)`)

  md.push(`\n## HQ-ONLY (in HQ, not in RW — report only, NOT auto-archived) — ${hqOnly.length}`)
  for (const r of hqOnly.slice(0, 40)) md.push(`- ${r.hqName} (${r.hqId})`)
  if (hqOnly.length > 40) md.push(`- …and ${hqOnly.length - 40} more (see CSV)`)

  writeFileSync(mdPath, md.join('\n'))

  // ── Console summary ──────────────────────────────────────────────
  console.log('===== BUCKET COUNTS =====')
  console.log(`MATCHED ${matched.length} · FUZZY ${fuzzyRows.length} · RW-ONLY ${rwOnly.length} · HQ-ONLY ${hqOnly.length}`)
  console.log(`I-Codes backfillable ${icodeBackfills.length} · prices fillable ${priceFills.length} · PRICE-CONFLICTS ${priceConflicts.length} · ICODE-CONFLICTS ${icodeConflicts.length}`)
  if (APPLY) console.log(`WRITTEN: rwICode ${icodesWritten} · prices ${pricesWritten} · audit rows ${auditRows}`)
  console.log(`\nreports:\n  ${mdPath}\n  ${csvPath}`)
  if (!APPLY) console.log(`\n(PREFLIGHT — no writes. Re-run with --apply after review.)`)

  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
