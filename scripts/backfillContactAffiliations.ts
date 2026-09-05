/**
 * Stage A of the CRM enrichment — give contacts the company they
 * already demonstrably belong to.
 *
 * ── The problem ─────────────────────────────────────────────────────
 * On 2026-08-26, 4,834 of 5,005 contacts (97%) had NO company
 * affiliation, which is why the Company column on /crm reads "--" for
 * nearly every row. Targeting by company is impossible in that state.
 *
 * ── The false start, recorded so nobody repeats it ──────────────────
 * The obvious fix is domain matching: bob@paramount.com → Paramount.
 * It yields exactly ZERO here, because of 4,193 Company rows, ONE has
 * a website and THREE have a billing email. There is nothing on the
 * Company side to match a domain against. (The resolver still exists —
 * src/lib/crm/domainCompanyMatch.ts — because the live capture path
 * uses it and it will start paying off as company records get filled
 * in. It is simply useless for a backfill today.)
 *
 * ── What actually works ─────────────────────────────────────────────
 * The capture pipeline has been resolving person↔company for months
 * and discarding the result. InquiryCapture carries BOTH `personId`
 * and `companyId`; 3,850 rows have both set. Nothing ever wrote the
 * Affiliation. The join is sitting in the audit table.
 *
 *   PASS 1  capture.personId + capture.companyId  → affiliation.
 *           Zero heuristics. The pipeline already did this work and
 *           the answer was thrown away.
 *
 *   PASS 2  capture.personId + capture.parsedCompanyString → resolve
 *           the signature-block company name against Company.name,
 *           exact first then normalized (drops LLC/Inc/Productions and
 *           punctuation). A normalized key hitting TWO companies is
 *           ambiguous and is skipped, never guessed.
 *
 *   PASS 3  report only. Company strings that match nothing, ranked by
 *           how many distinct contacts name them — the shortlist worth
 *           creating Company rows for. NOT auto-created: the list is
 *           full of vendors and schools (Office Depot, USC) alongside
 *           real production companies, and only a human can tell the
 *           difference.
 *
 * Safety:
 *   - Dry run by default; --write applies.
 *   - Only CREATES. Never edits or deletes an existing affiliation.
 *   - Skips any (person, company) pair that already has one, so
 *     re-running is idempotent.
 *   - --write appends every created id to
 *     journals/affiliation-backfill-<stamp>.json so the run is reversible
 *     BY CAPTURED ID (SHIPLOG "Hard Rules").
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/backfillContactAffiliations.ts          # dry run
 *   npx tsx scripts/backfillContactAffiliations.ts --write  # apply
 */

import './_loadProdEnv'
import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'node:fs'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')

/**
 * Normalize a company name for matching. Strips punctuation and the
 * entity/industry suffixes that appear inconsistently between a
 * signature block and a CRM record — "Contrast Films LLC" and
 * "Contrast Films" are the same client.
 *
 * Deliberately NOT aggressive beyond that: no fuzzy distance, no
 * token subset matching. A wrong company attachment is worse than a
 * missing one, because it silently mis-targets every campaign built
 * on top of it.
 */
function normalizeCompanyName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,''`"]/g, '')
    .replace(/\band\b/g, '&')
    .replace(/\b(llc|l\.l\.c|inc|incorporated|ltd|limited|corp|corporation|company|co|productions|production|prods|prod)\b/g, '')
    .replace(/[^a-z0-9&\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface Plan {
  personId: string
  companyId: string
  companyName: string
  personLabel: string
  source: 'capture-resolved' | 'name-exact' | 'name-normalized'
}

async function main() {
  console.log(WRITE ? '=== APPLYING ===' : '=== DRY RUN (pass --write to apply) ===\n')

  const [companies, existingAffils, captures] = await Promise.all([
    prisma.company.findMany({ select: { id: true, name: true } }),
    prisma.affiliation.findMany({ select: { personId: true, companyId: true } }),
    prisma.inquiryCapture.findMany({
      where: { personId: { not: null } },
      select: { personId: true, companyId: true, parsedCompanyString: true },
    }),
  ])

  const have = new Set(existingAffils.map((a) => `${a.personId}|${a.companyId}`))
  const companyById = new Map(companies.map((c) => [c.id, c.name]))

  // Exact-name index, and a normalized index that records collisions.
  const exactIdx = new Map<string, string>()
  const normIdx = new Map<string, Set<string>>()
  for (const c of companies) {
    exactIdx.set(c.name.trim().toLowerCase(), c.id)
    const k = normalizeCompanyName(c.name)
    if (!k) continue
    const bucket = normIdx.get(k)
    if (bucket) bucket.add(c.id)
    else normIdx.set(k, new Set([c.id]))
  }

  const plans = new Map<string, Plan>()   // key: personId|companyId
  const unmatchedStrings = new Map<string, Set<string>>() // string -> personIds
  let ambiguousStrings = 0

  for (const cap of captures) {
    const personId = cap.personId as string

    // PASS 1 — the pipeline already resolved it.
    if (cap.companyId) {
      const key = `${personId}|${cap.companyId}`
      if (!have.has(key) && !plans.has(key)) {
        plans.set(key, {
          personId,
          companyId: cap.companyId,
          companyName: companyById.get(cap.companyId) ?? '(unknown)',
          personLabel: personId,
          source: 'capture-resolved',
        })
      }
      continue
    }

    // PASS 2 — resolve the signature-block company string.
    const raw = (cap.parsedCompanyString ?? '').trim()
    if (raw.length < 3) continue

    const exactHit = exactIdx.get(raw.toLowerCase())
    if (exactHit) {
      const key = `${personId}|${exactHit}`
      if (!have.has(key) && !plans.has(key)) {
        plans.set(key, {
          personId, companyId: exactHit,
          companyName: companyById.get(exactHit) ?? raw,
          personLabel: personId, source: 'name-exact',
        })
      }
      continue
    }

    const normKey = normalizeCompanyName(raw)
    const bucket = normKey ? normIdx.get(normKey) : undefined
    if (bucket && bucket.size === 1) {
      const companyId = [...bucket][0]
      const key = `${personId}|${companyId}`
      if (!have.has(key) && !plans.has(key)) {
        plans.set(key, {
          personId, companyId,
          companyName: companyById.get(companyId) ?? raw,
          personLabel: personId, source: 'name-normalized',
        })
      }
      continue
    }
    if (bucket && bucket.size > 1) { ambiguousStrings += 1; continue }

    const seen = unmatchedStrings.get(raw)
    if (seen) seen.add(personId)
    else unmatchedStrings.set(raw, new Set([personId]))
  }

  // Label the people for a readable report.
  const personIds = [...new Set([...plans.values()].map((p) => p.personId))]
  const people = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, firstName: true, lastName: true, email: true, affiliations: { select: { id: true }, take: 1 } },
  })
  const labelById = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName} <${p.email}>`]))
  const hadNone = new Set(people.filter((p) => p.affiliations.length === 0).map((p) => p.id))
  for (const plan of plans.values()) plan.personLabel = labelById.get(plan.personId) ?? plan.personId

  const bySource = { 'capture-resolved': 0, 'name-exact': 0, 'name-normalized': 0 }
  for (const p of plans.values()) bySource[p.source] += 1

  console.log('AFFILIATIONS TO CREATE')
  console.log(`  pass 1 — already resolved by the capture pipeline : ${bySource['capture-resolved']}`)
  console.log(`  pass 2 — signature company matched exactly        : ${bySource['name-exact']}`)
  console.log(`  pass 2 — signature company matched normalized     : ${bySource['name-normalized']}`)
  console.log(`  ${'TOTAL'.padEnd(50)}: ${plans.size}`)
  console.log(`\n  distinct people affected            : ${personIds.length}`)
  console.log(`  of those, currently unaffiliated    : ${hadNone.size}`)
  console.log(`  ambiguous company strings skipped   : ${ambiguousStrings}`)

  console.log('\nSAMPLE')
  ;[...plans.values()].slice(0, 12).forEach((p) =>
    console.log(`  ${p.personLabel}\n      → ${p.companyName}   [${p.source}]`),
  )

  console.log('\nPASS 3 — unmatched company names, ranked by how many contacts name them.')
  console.log('These are candidates for new Company rows. NOT created by this script —')
  console.log('the list mixes real production companies with vendors and schools.\n')
  ;[...unmatchedStrings.entries()]
    .map(([name, set]) => ({ name, n: set.size }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 25)
    .forEach((r) => console.log(`  ${String(r.n).padStart(3)} contacts  ${r.name}`))
  console.log(`\n  (${unmatchedStrings.size} distinct unmatched names in total)`)

  if (!WRITE) {
    console.log(`\nDry run complete. Re-run with --write to create ${plans.size} affiliations.`)
    return
  }

  const createdIds: string[] = []
  let failed = 0
  for (const plan of plans.values()) {
    try {
      const row = await prisma.affiliation.create({
        data: {
          personId: plan.personId,
          companyId: plan.companyId,
          isCurrent: true,
          notes: `backfillContactAffiliations ${new Date().toISOString().slice(0, 10)} [${plan.source}]`,
        },
        select: { id: true },
      })
      createdIds.push(row.id)
    } catch (err) {
      failed += 1
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  FAILED ${plan.personLabel} → ${plan.companyName}: ${msg.split('\n')[0]}`)
    }
  }

  mkdirSync('journals', { recursive: true })
  const path = `journals/affiliation-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(path, JSON.stringify({ createdAffiliationIds: createdIds }, null, 2))
  console.log(`\nCreated ${createdIds.length} affiliations (${failed} failed).`)
  console.log(`Reversal list: ${path} — delete BY THESE IDS ONLY if this needs undoing.`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
