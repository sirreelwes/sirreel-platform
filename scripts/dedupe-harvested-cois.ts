#!/usr/bin/env tsx
/**
 * Collapse duplicate harvested certificates on named insured + expiry.
 *
 * Wes, 2026-09-02. The email harvest collapses attachments on FILENAME, but
 * the same certificate arrives under different names — Pop Up Mob's came in
 * as both "Updated Certificate Pop Up Mob.pdf" and "SirReel COI.pdf",
 * insuring the same entity to the same date. Two rows, one certificate.
 *
 * Insured + expiry is the right key: it is what the document actually says
 * about itself, and it survives whatever the sender called the file.
 *
 * ── The one thing this must not do ─────────────────────────────────
 *
 * Collapse a PROPERTY certificate into a LIABILITY one. A company's policies
 * frequently share a renewal date, so "same insured, same expiry" is NOT
 * enough on its own — American Greetings sent separate liability and
 * property certificates, and losing either would take away a coverage the
 * review desk is supposed to check. Groups whose filenames name different
 * coverage types are therefore left alone and reported.
 *
 * Scope is deliberately narrow: only rows this harvest created
 * (source=EMAIL_HARVEST) that are still PENDING. A certificate a human has
 * decided, or a client uploaded, is never touched.
 *
 * Usage:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/dedupe-harvested-cois.ts           # dry run
 *   npx tsx scripts/dedupe-harvested-cois.ts --write
 *
 * Reverse: tmp/coi-dedupe-<ts>.json holds the full body of every deleted
 * row. Recreation is BY CAPTURED ID only.
 */
import fs from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'

const WRITE = process.argv.includes('--write')

/**
 * Coverage types a filename can declare. Two certificates in the same
 * insured+expiry group that name DIFFERENT types are different documents.
 */
const COVERAGE_TYPES: { key: string; re: RegExp }[] = [
  { key: 'liability', re: /\bliab/i },
  { key: 'property', re: /\bprop/i },
  { key: 'auto', re: /\bauto|\bvehicle/i },
  { key: 'workers-comp', re: /\bwork(ers)?[\s_-]*comp|\bwc\b/i },
  { key: 'umbrella', re: /\bumbrella|\bexcess/i },
  { key: 'inland-marine', re: /\binland|\bmarine|\bequip/i },
]

function coverageOf(filename: string): string | null {
  for (const c of COVERAGE_TYPES) if (c.re.test(filename)) return c.key
  return null
}

function normInsured(s: string | null): string {
  return (s || '')
    .toLowerCase()
    .split('\n')[0] // the AI sometimes returns insured + address; the name is line 1
    .replace(/\b(inc|llc|ltd|co|corp|company|incorporated|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

async function main() {
  const rows = await prisma.coiCheck.findMany({
    where: { deletedAt: null, source: 'EMAIL_HARVEST', humanDecision: 'PENDING' },
    select: {
      id: true, companyId: true, namedInsured: true, policyExpiryDate: true,
      originalFilename: true, fileSize: true, createdAt: true,
      aiRiskLevel: true, coverageVerified: true, additionalInsured: true,
      company: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Harvested PENDING certificates: ${rows.length}\n`)

  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = [
      r.companyId,
      normInsured(r.namedInsured),
      r.policyExpiryDate?.toISOString().slice(0, 10) ?? 'none',
    ].join('|')
    groups.set(key, [...(groups.get(key) ?? []), r])
  }

  const toDelete: typeof rows = []
  let keptGroups = 0
  let splitGroups = 0

  for (const [, g] of groups) {
    if (g.length < 2) continue

    // Different coverage types in one group? Then they are different
    // documents that happen to share a renewal date. Leave them.
    const types = new Set(g.map((r) => coverageOf(r.originalFilename)).filter(Boolean))
    if (types.size > 1) {
      splitGroups++
      console.log(
        `  KEEP ALL (${[...types].join(' + ')}) — ${g[0].company?.name}: ${g.map((r) => r.originalFilename).join(' | ')}`,
      )
      continue
    }

    // Keep the richest row: additional-insured confirmed first, then the
    // larger file (a fuller document beats a one-page excerpt), then the
    // earliest — the copy that actually arrived first.
    const sorted = [...g].sort((a, b) => {
      if (a.additionalInsured !== b.additionalInsured) return a.additionalInsured ? -1 : 1
      if (a.fileSize !== b.fileSize) return b.fileSize - a.fileSize
      return a.createdAt.getTime() - b.createdAt.getTime()
    })
    const keep = sorted[0]
    const drop = sorted.slice(1)
    keptGroups++
    console.log(
      `  ${g[0].company?.name} — "${keep.namedInsured?.split('\n')[0]}" exp ${keep.policyExpiryDate?.toISOString().slice(0, 10)}`,
    )
    console.log(`      keep: ${keep.originalFilename} (${keep.fileSize}b)`)
    for (const d of drop) console.log(`      drop: ${d.originalFilename} (${d.fileSize}b)`)
    toDelete.push(...drop)
  }

  console.log(`\nGroups collapsed: ${keptGroups} · left alone (different coverage): ${splitGroups}`)
  console.log(`Rows to delete: ${toDelete.length} · remaining after: ${rows.length - toDelete.length}`)

  if (!WRITE) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --write.\n')
    return
  }

  const journal = toDelete.map((r) => ({
    coiCheckId: r.id,
    companyId: r.companyId,
    company: r.company?.name,
    namedInsured: r.namedInsured,
    expiry: r.policyExpiryDate?.toISOString() ?? null,
    originalFilename: r.originalFilename,
    fileSize: r.fileSize,
  }))

  let deleted = 0
  for (const r of toDelete) {
    // Re-read before deleting: the harvest may still be running, and a
    // reviewer may have decided this row since the query above.
    const fresh = await prisma.coiCheck.findUnique({
      where: { id: r.id },
      select: { id: true, humanDecision: true },
    })
    if (!fresh) continue
    if (fresh.humanDecision !== 'PENDING') {
      console.log(`  SKIP ${r.id} — decided since the scan (${fresh.humanDecision})`)
      continue
    }
    await prisma.coiCheck.delete({ where: { id: r.id } })
    deleted++
  }

  const out = path.join(process.cwd(), `tmp/coi-dedupe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(out, JSON.stringify(journal, null, 2))
  console.log(`\nDeleted ${deleted}. Journal (reversible by captured id): ${out}\n`)
}

main().finally(() => prisma.$disconnect())
