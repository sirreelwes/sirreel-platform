#!/usr/bin/env tsx
/**
 * One-shot backfill that applies the post-extraction category re-stamp to
 * EmailMessage rows that were extracted before the re-stamp landed
 * (commit 56e3694). For every inbound row where extractedData.messageNature
 * = 'inquiry' AND extractionConfidence >= 0.5, set category =
 * 'BOOKING_INQUIRY' (promote-only — never demotes).
 *
 *   npx tsx scripts/backfill-category-restamp.ts --dry-run
 *   npx tsx scripts/backfill-category-restamp.ts
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import path from 'path'

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const prisma = new PrismaClient()

const CONFIDENCE_FLOOR = 0.5

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[restamp] dryRun=${dryRun} floor=${CONFIDENCE_FLOOR}`)

  const candidates = await prisma.emailMessage.findMany({
    where: {
      direction: 'inbound',
      duplicateOfId: null,
      extractedData: { path: ['messageNature'], equals: 'inquiry' },
      extractionConfidence: { gte: CONFIDENCE_FLOOR },
      NOT: { category: 'BOOKING_INQUIRY' },
    },
    select: { id: true, category: true, subject: true, fromAddress: true },
  })

  console.log(`[restamp] candidates=${candidates.length}`)

  const beforeDist: Record<string, number> = {}
  for (const c of candidates) {
    const key = c.category ?? 'NULL'
    beforeDist[key] = (beforeDist[key] || 0) + 1
  }
  console.log('[restamp] current category distribution among promotions:', beforeDist)

  if (dryRun) {
    console.log('[restamp] dry-run sample (first 10):')
    for (const c of candidates.slice(0, 10)) {
      console.log(`  ${c.category ?? 'NULL'} → BOOKING_INQUIRY | ${c.fromAddress} | ${c.subject?.slice(0, 60)}`)
    }
    return
  }

  const ids = candidates.map((c) => c.id)
  const BATCH = 500
  let updated = 0
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH)
    const res = await prisma.emailMessage.updateMany({
      where: { id: { in: slice } },
      data: { category: 'BOOKING_INQUIRY' },
    })
    updated += res.count
    console.log(`[restamp] batch ${i / BATCH + 1}: ${res.count} rows`)
  }
  console.log(`[restamp] done. updated=${updated}`)
}

main()
  .catch((e) => {
    console.error('[restamp] fatal:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
