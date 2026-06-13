/**
 * RentalWorks rate gap-fill — preflight + apply.
 *
 * Default: PREFLIGHT only. Generates tmp/rw-rate-fill-preflight.md and
 * STOPS. Designed to be run, eyeballed, then re-run with `--apply` only
 * after Wes signs off on the two human-judgment buckets (name/token
 * matches + conflicts).
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   export RENTALWORKS_TOKEN=$(grep '^RENTALWORKS_TOKEN' .env.local | cut -d'=' -f2-)
 *   npx tsx scripts/rw-rate-gap-fill.ts
 *
 * After review:
 *   npx tsx scripts/rw-rate-gap-fill.ts --apply
 *
 * Companion to (but distinct from) scripts/rw-catalog-import.ts. That
 * one is the full re-sync (codes, descriptions, manufacturer, dims,
 * specs, replacement cost). This one ONLY touches dailyRate and
 * weeklyRate, and ONLY on rows whose HQ daily rate is currently $0.
 *
 * Hard rules:
 *   - GAP-FILL ONLY. HQ `dailyRate > 0` is NEVER overwritten — those
 *     land in the CONFLICT bucket (logged for review, no write).
 *   - No --force, no --overwrite flag. If a reviewer decides a stale
 *     HQ rate is wrong, the explicit-and-audited path is to clear it
 *     to 0 by hand and re-run.
 *   - Ambiguous name/token matches (>1 RW master) → SKIP, log under
 *     "Manual review needed" — never auto-guess.
 *   - Existing-rows-only. No auto-create branch. RW-only items are out
 *     of scope here; that's what rw-catalog-import.ts does.
 *   - AssetCategory rates are NOT touched (9 rows, no rwId crosswalk,
 *     hand-fix is shorter than wiring fleet matching).
 *   - Every write emits a RateChangeLog row in the same transaction so
 *     the audit trail can't drift from the data.
 *
 * SAFETY CONTRACT — line item rates are snapshotted at create time.
 * OrderLineItem.rate is persisted on insert (see
 * src/app/api/orders/[id]/line-items/route.ts line 126); recalcOrderTotals
 * reads from OrderLineItem.rate, never from InventoryItem.dailyRate.
 * Verified before this script was written. Filling catalog rates
 * retroactively CANNOT move any existing order/quote/invoice total.
 */

import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'
import { fetchAllItems, groupItemsToMasters, type RwMaster } from '../src/lib/rentalworks/client'
import type { LineItemDepartment } from '@prisma/client'

const APPLY = process.argv.includes('--apply')

// ─────────────────────────────────────────────────────────────────────
// Normalization — identical to scripts/rw-catalog-import.ts so the two
// scripts can't drift their match logic. Kept as private copies rather
// than imported because rw-catalog-import.ts has them inline; lifting
// to a shared helper is a follow-up cleanup.
// ─────────────────────────────────────────────────────────────────────
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'with', 'and', 'or', 'for'])

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/^utah\s*-?\s*/i, '')
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
// Classification
// ─────────────────────────────────────────────────────────────────────
type MatchMethod = 'rwId' | 'code' | 'name' | 'tokens'

interface FillRow {
  sirreelId: string
  sirreelCode: string
  description: string
  department: LineItemDepartment
  oldDaily: number
  oldWeekly: number
  newDaily: number
  newWeekly: number
  rwMaster: RwMaster
  matchMethod: MatchMethod
}

interface ConflictRow {
  sirreelId: string
  sirreelCode: string
  description: string
  department: LineItemDepartment
  hqDaily: number
  hqWeekly: number
  rwDaily: number
  rwWeekly: number
  rwIcode: string
  rwId: string
  matchMethod: MatchMethod
}

interface AmbiguousRow {
  sirreelCode: string
  description: string
  department: LineItemDepartment
  candidates: { iCode: string; description: string; rwId: string; dailyRate: number }[]
  matchMethod: 'name' | 'tokens'
}

interface SadZeroRow {
  sirreelCode: string
  description: string
  department: LineItemDepartment
  rwIcode: string
  rwId: string
  matchMethod: MatchMethod
}

interface MissRow {
  sirreelCode: string
  description: string
  department: LineItemDepartment
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`RW rate gap-fill — ${APPLY ? '🚀 APPLY MODE (will write to DB)' : 'PREFLIGHT only (no writes)'}`)
  console.log()

  // 1. Pull RW masters
  console.log('Pulling RW /api/v1/item …')
  const items = await fetchAllItems({
    pageSize: 200,
    onPage: (p, tp, fetched, total) =>
      console.log(`  page ${p}/${tp} — ${fetched}/${total} items`),
  })
  const masters = groupItemsToMasters(items)
  console.log(`  ${items.length} physical items → ${masters.length} masters`)

  // 2. Build RW lookup indexes
  const rwById = new Map<string, RwMaster>()
  const rwByICode = new Map<string, RwMaster>()
  const rwByNormalizedName = new Map<string, RwMaster[]>()
  const rwByTokenSet = new Map<string, RwMaster[]>()
  for (const m of masters) {
    rwById.set(m.rwInventoryId, m)
    if (m.iCode) rwByICode.set(m.iCode, m)
    const norm = normalizeName(m.description)
    if (norm) {
      const arr = rwByNormalizedName.get(norm) ?? []
      arr.push(m)
      rwByNormalizedName.set(norm, arr)
    }
    const tk = tokenSetKey(m.description)
    if (tk) {
      const arr = rwByTokenSet.get(tk) ?? []
      arr.push(m)
      rwByTokenSet.set(tk, arr)
    }
  }

  // 3. Pull HQ active inventory — we look at ALL rows so we can
  //    compute conflict counts on non-$0 rows, not just $0 rows.
  const hq = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: {
      id: true, code: true, description: true, department: true,
      dailyRate: true, weeklyRate: true, rwId: true,
    },
  })
  console.log(`  ${hq.length} active HQ inventory items`)

  // 4. Classify each HQ row
  const fills: FillRow[] = []
  const conflicts: ConflictRow[] = []
  const ambiguous: AmbiguousRow[] = []
  const sadZero: SadZeroRow[] = []
  const miss: MissRow[] = []
  let alreadyAligned = 0
  let nonZeroNoCheck = 0

  for (const h of hq) {
    const hqDaily = Number(h.dailyRate)
    const hqWeekly = Number(h.weeklyRate)

    // Find the matching RW master, in priority order.
    let rw: RwMaster | null = null
    let method: MatchMethod | null = null
    let ambig = false

    if (h.rwId && rwById.has(h.rwId)) {
      rw = rwById.get(h.rwId)!
      method = 'rwId'
    } else if (rwByICode.has(h.code)) {
      rw = rwByICode.get(h.code)!
      method = 'code'
    } else {
      const text = h.description || h.code
      const nameKey = normalizeName(text)
      const nameHits = rwByNormalizedName.get(nameKey) ?? []
      if (nameHits.length === 1) {
        rw = nameHits[0]
        method = 'name'
      } else if (nameHits.length > 1) {
        ambig = true
        ambiguous.push({
          sirreelCode: h.code,
          description: text,
          department: h.department,
          candidates: nameHits.slice(0, 5).map((m) => ({
            iCode: m.iCode, description: m.description, rwId: m.rwInventoryId, dailyRate: m.dailyRate,
          })),
          matchMethod: 'name',
        })
      } else {
        const tk = tokenSetKey(text)
        const tokenHits = rwByTokenSet.get(tk) ?? []
        if (tokenHits.length === 1) {
          rw = tokenHits[0]
          method = 'tokens'
        } else if (tokenHits.length > 1) {
          ambig = true
          ambiguous.push({
            sirreelCode: h.code,
            description: text,
            department: h.department,
            candidates: tokenHits.slice(0, 5).map((m) => ({
              iCode: m.iCode, description: m.description, rwId: m.rwInventoryId, dailyRate: m.dailyRate,
            })),
            matchMethod: 'tokens',
          })
        }
      }
    }

    if (ambig) continue
    if (!rw || !method) {
      // No match at all. Only log as MISS if HQ is $0 (the gap we care
      // about); $0 rows with no RW match are the manual-set bucket.
      if (hqDaily === 0) {
        miss.push({
          sirreelCode: h.code,
          description: h.description ?? '',
          department: h.department,
        })
      }
      continue
    }

    const rwDaily = Number(rw.dailyRate) || 0
    const rwWeekly = Number(rw.weeklyRate) || 0

    if (hqDaily === 0 && rwDaily > 0) {
      // GAP-FILL — the happy path.
      fills.push({
        sirreelId: h.id,
        sirreelCode: h.code,
        description: h.description ?? '',
        department: h.department,
        oldDaily: 0,
        oldWeekly: hqWeekly,
        newDaily: rwDaily,
        // Fill BOTH columns to keep the combobox display consistent.
        // Even when RW weekly is $0 we still write 0 — that's a
        // no-op (HQ weekly was already 0 in the unfilled case).
        // We DO NOT overwrite a non-zero HQ weekly silently here;
        // if hqWeekly > 0 and rwWeekly differs, fill rate stays the
        // RW value (matches the spec: combobox consistency wins; the
        // weekly retirement is a separate cleanup).
        newWeekly: rwWeekly,
        rwMaster: rw,
        matchMethod: method,
      })
    } else if (hqDaily === 0 && rwDaily === 0) {
      // Both sides are $0 — RW master has no rate either. These need
      // a human; not RW-fixable. Surface separately so the reviewer
      // doesn't confuse them with "won't fill because conflict".
      sadZero.push({
        sirreelCode: h.code,
        description: h.description ?? '',
        department: h.department,
        rwIcode: rw.iCode,
        rwId: rw.rwInventoryId,
        matchMethod: method,
      })
    } else if (hqDaily > 0 && rwDaily > 0 && Math.abs(hqDaily - rwDaily) > 0.01) {
      // CONFLICT — log-only, never written. A reviewer may decide to
      // clear HQ to $0 manually and re-run, or leave HQ as-is.
      conflicts.push({
        sirreelId: h.id,
        sirreelCode: h.code,
        description: h.description ?? '',
        department: h.department,
        hqDaily,
        hqWeekly,
        rwDaily,
        rwWeekly,
        rwIcode: rw.iCode,
        rwId: rw.rwInventoryId,
        matchMethod: method,
      })
    } else if (hqDaily > 0 && rwDaily > 0) {
      alreadyAligned++
    } else {
      // hqDaily > 0 && rwDaily === 0 — HQ has a rate, RW doesn't.
      // No action; HQ's value stands.
      nonZeroNoCheck++
    }
  }

  // 5. Group fills by match method so the reviewer can attack the
  //    safe bucket (rwId) separately from the eyeball bucket (name/tokens).
  const fillsByRwId = fills.filter((f) => f.matchMethod === 'rwId')
  const fillsByCode = fills.filter((f) => f.matchMethod === 'code')
  const fillsByName = fills.filter((f) => f.matchMethod === 'name')
  const fillsByTokens = fills.filter((f) => f.matchMethod === 'tokens')

  // 6. Emit preflight markdown
  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push('# RW rate gap-fill — preflight')
  push('')
  push(`Run at: ${new Date().toISOString()}`)
  push(`Mode: ${APPLY ? 'APPLY (writes pending)' : 'PREFLIGHT (no writes)'}`)
  push('')
  push('## Summary')
  push('')
  push('| Bucket | Count |')
  push('|---|---:|')
  push(`| Will fill — rwId exact (safe) | **${fillsByRwId.length}** |`)
  push(`| Will fill — code exact (safe) | **${fillsByCode.length}** |`)
  push(`| Will fill — name match (REVIEW) | **${fillsByName.length}** |`)
  push(`| Will fill — token match (REVIEW) | **${fillsByTokens.length}** |`)
  push(`| Conflict (log-only, no write) | **${conflicts.length}** |`)
  push(`| Ambiguous (>1 RW match — SKIPPED) | **${ambiguous.length}** |`)
  push(`| Both HQ and RW are $0 | **${sadZero.length}** |`)
  push(`| HQ $0, no RW match at all | **${miss.length}** |`)
  push(`| Already aligned (no-op) | ${alreadyAligned} |`)
  push(`| HQ has rate, RW has none (no-op) | ${nonZeroNoCheck} |`)
  push('')
  push(`**Total fill writes pending:** ${fills.length}`)
  push('')

  push('---')
  push('')

  // ── Will fill — rwId exact (safe to apply without per-row review)
  push('## A. Will fill — rwId exact match (safe)')
  push('')
  push(`Total: **${fillsByRwId.length}**. These rows already carry a stable rwId crosswalk to RW.`)
  push('')
  if (fillsByRwId.length > 0) {
    push('| HQ code | Description | Dept | Current daily | RW daily | RW weekly |')
    push('|---|---|---|---:|---:|---:|')
    for (const f of fillsByRwId) {
      push(`| \`${f.sirreelCode}\` | ${f.description} | ${f.department} | ${fmtMoney(f.oldDaily)} | ${fmtMoney(f.newDaily)} | ${fmtMoney(f.newWeekly)} |`)
    }
    push('')
  }

  // ── Will fill — code exact
  push('## B. Will fill — code exact match (safe)')
  push('')
  push(`Total: **${fillsByCode.length}**. HQ.code matches RW.ICode exactly. Also stamps rwId on apply.`)
  push('')
  if (fillsByCode.length > 0) {
    push('| HQ code | Description | Dept | RW daily | RW weekly |')
    push('|---|---|---|---:|---:|')
    for (const f of fillsByCode) {
      push(`| \`${f.sirreelCode}\` | ${f.description} | ${f.department} | ${fmtMoney(f.newDaily)} | ${fmtMoney(f.newWeekly)} |`)
    }
    push('')
  }

  // ── Will fill — name match (REVIEW)
  push('## C. Will fill — normalized-name match (REVIEW THESE)')
  push('')
  push(`Total: **${fillsByName.length}**. Eyeball: are the RW masters actually the same item?`)
  push('')
  if (fillsByName.length > 0) {
    push('| HQ code | HQ description | RW ICode | RW description | Dept | RW daily | RW weekly |')
    push('|---|---|---|---|---|---:|---:|')
    for (const f of fillsByName) {
      push(`| \`${f.sirreelCode}\` | ${f.description} | \`${f.rwMaster.iCode}\` | ${f.rwMaster.description} | ${f.department} | ${fmtMoney(f.newDaily)} | ${fmtMoney(f.newWeekly)} |`)
    }
    push('')
  }

  // ── Will fill — token match (REVIEW)
  push('## D. Will fill — token-bag match (REVIEW THESE)')
  push('')
  push(`Total: **${fillsByTokens.length}**. Word-order-insensitive match. Higher risk than name match — eyeball.`)
  push('')
  if (fillsByTokens.length > 0) {
    push('| HQ code | HQ description | RW ICode | RW description | Dept | RW daily | RW weekly |')
    push('|---|---|---|---|---|---:|---:|')
    for (const f of fillsByTokens) {
      push(`| \`${f.sirreelCode}\` | ${f.description} | \`${f.rwMaster.iCode}\` | ${f.rwMaster.description} | ${f.department} | ${fmtMoney(f.newDaily)} | ${fmtMoney(f.newWeekly)} |`)
    }
    push('')
  }

  // ── Conflicts
  push('## E. Conflicts (LOG-ONLY — never written by this script)')
  push('')
  push(`Total: **${conflicts.length}**. HQ has a rate, RW has a different rate. If you want HQ to take RW's value, manually clear HQ.dailyRate to 0 and re-run preflight; the row will then move to A/B/C.`)
  push('')
  if (conflicts.length > 0) {
    push('| HQ code | Description | Match | HQ daily | RW daily | Δ | HQ weekly | RW weekly |')
    push('|---|---|---|---:|---:|---:|---:|---:|')
    for (const c of conflicts) {
      const delta = c.rwDaily - c.hqDaily
      push(`| \`${c.sirreelCode}\` | ${c.description} | ${c.matchMethod} | ${fmtMoney(c.hqDaily)} | ${fmtMoney(c.rwDaily)} | ${fmtMoney(delta)} | ${fmtMoney(c.hqWeekly)} | ${fmtMoney(c.rwWeekly)} |`)
    }
    push('')
  }

  // ── Ambiguous matches (>1 RW master) — skipped
  push('## F. Ambiguous matches (>1 RW master — SKIPPED)')
  push('')
  push(`Total: **${ambiguous.length}**. Multiple RW masters share a normalized name / token set with the HQ row. No write. Resolve by: (a) editing the HQ description to be more specific, or (b) stamping HQ.rwId by hand to the correct RW master.`)
  push('')
  if (ambiguous.length > 0) {
    push('| HQ code | HQ description | Method | RW candidates |')
    push('|---|---|---|---|')
    for (const a of ambiguous) {
      const cands = a.candidates.map((c) => `\`${c.iCode}\` "${c.description}" (${fmtMoney(c.dailyRate)})`).join(' · ')
      push(`| \`${a.sirreelCode}\` | ${a.description} | ${a.matchMethod} | ${cands} |`)
    }
    push('')
  }

  // ── Sad zeros
  push('## G. HQ $0 + RW $0 (RW master has no rate either)')
  push('')
  push(`Total: **${sadZero.length}**. RW knows about the item but has no rate set. Set manually in HQ.`)
  push('')
  if (sadZero.length > 0) {
    push('| HQ code | Description | Dept | RW ICode | Match |')
    push('|---|---|---|---|---|')
    for (const s of sadZero) {
      push(`| \`${s.sirreelCode}\` | ${s.description} | ${s.department} | \`${s.rwIcode}\` | ${s.matchMethod} |`)
    }
    push('')
  }

  // ── Miss
  push('## H. HQ $0, no RW match at all')
  push('')
  push(`Total: **${miss.length}**. No RW master found via rwId / code / name / tokens. Set manually in HQ.`)
  push('')
  if (miss.length > 0) {
    push('| HQ code | Description | Dept |')
    push('|---|---|---|')
    for (const m of miss) {
      push(`| \`${m.sirreelCode}\` | ${m.description} | ${m.department} |`)
    }
    push('')
  }

  const preflightPath = path.join(process.cwd(), 'tmp/rw-rate-fill-preflight.md')
  mkdirSync(path.dirname(preflightPath), { recursive: true })
  writeFileSync(preflightPath, lines.join('\n'))
  console.log()
  console.log(`✓ Preflight written: ${preflightPath}`)
  console.log()
  console.log('───── SUMMARY ─────')
  console.log(`Will fill — rwId exact:    ${fillsByRwId.length}  (safe)`)
  console.log(`Will fill — code exact:    ${fillsByCode.length}  (safe)`)
  console.log(`Will fill — name match:    ${fillsByName.length}  (REVIEW)`)
  console.log(`Will fill — token match:   ${fillsByTokens.length}  (REVIEW)`)
  console.log(`Conflicts (log-only):      ${conflicts.length}`)
  console.log(`Ambiguous (skipped):       ${ambiguous.length}`)
  console.log(`Both $0 (RW also missing): ${sadZero.length}`)
  console.log(`HQ $0, no RW match:        ${miss.length}`)
  console.log(`No-op (already aligned):   ${alreadyAligned}`)

  if (!APPLY) {
    console.log()
    console.log('Preflight only — STOP and review the .md file. Re-run with --apply to write.')
    return
  }

  // ─────────────────────────────────────────────────────────────────
  // APPLY
  // ─────────────────────────────────────────────────────────────────
  console.log()
  console.log('🚀 APPLY MODE — writing GAP_FILL set …')

  // Stamp the apply with the operator's User row when one exists for
  // the wes@sirreel.com identity. Optional column; null is fine for
  // automated runs.
  const wes = await prisma.user.findFirst({
    where: { email: { equals: 'wes@sirreel.com', mode: 'insensitive' } },
    select: { id: true },
  })
  const appliedById = wes?.id ?? null

  let written = 0
  const now = new Date()
  for (const f of fills) {
    // Each row: one Person.update + one RateChangeLog.create in the
    // same transaction. Atomic on success; on failure, no half-state.
    await prisma.$transaction([
      prisma.inventoryItem.update({
        where: { id: f.sirreelId },
        data: {
          dailyRate: f.newDaily,
          weeklyRate: f.newWeekly,
          // Stamp rwId when we matched via name/code/tokens — closes
          // the linkage gap simultaneously with the rate fill.
          ...(f.matchMethod !== 'rwId' ? { rwId: f.rwMaster.rwInventoryId } : {}),
          rwLastSyncedAt: now,
        },
      }),
      prisma.rateChangeLog.create({
        data: {
          inventoryItemId: f.sirreelId,
          oldDailyRate: f.oldDaily,
          newDailyRate: f.newDaily,
          oldWeeklyRate: f.oldWeekly,
          newWeeklyRate: f.newWeekly,
          source: 'RW_GAP_FILL',
          rwIdSource: f.rwMaster.rwInventoryId,
          matchMethod: f.matchMethod,
          appliedById,
          appliedAt: now,
        },
      }),
    ])
    written++
  }

  // ── Applied report
  const applied: string[] = []
  applied.push('# RW rate gap-fill — applied')
  applied.push('')
  applied.push(`Run at: ${now.toISOString()}`)
  applied.push(`Operator: ${appliedById ? `User ${appliedById}` : '(no operator id)'}`)
  applied.push('')
  applied.push(`- Rows written: **${written}**`)
  applied.push(`- Conflicts (still logged, no action): **${conflicts.length}**`)
  applied.push(`- Ambiguous (skipped): **${ambiguous.length}**`)
  applied.push(`- Both $0: **${sadZero.length}**`)
  applied.push(`- No RW match: **${miss.length}**`)
  applied.push('')
  applied.push('Audit trail: `SELECT * FROM rate_change_log WHERE source = \'RW_GAP_FILL\' ORDER BY applied_at DESC`')
  const appliedPath = path.join(process.cwd(), 'tmp/rw-rate-fill-applied.md')
  writeFileSync(appliedPath, applied.join('\n'))
  console.log()
  console.log(`✓ Applied. Report at ${appliedPath}`)
  console.log(`  Rows written: ${written}`)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
