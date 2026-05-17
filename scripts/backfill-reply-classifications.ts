#!/usr/bin/env tsx
/**
 * One-time backfill — classifies historical inbound replies that pre-date the
 * pubsub-side classification hook. Walks recent inbound EmailMessages where
 * replyClassification is still null, calls the Claude classifier, and
 * persists. Idempotent: re-running only touches rows still missing a
 * classification.
 *
 * Run:
 *   npx tsx scripts/backfill-reply-classifications.ts                # last 14 days
 *   npx tsx scripts/backfill-reply-classifications.ts --days 60      # custom window
 *   npx tsx scripts/backfill-reply-classifications.ts --limit 50     # cap batch
 *   npx tsx scripts/backfill-reply-classifications.ts --dry-run      # don't write
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import path from 'path'

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

import { classifyReply } from '../src/lib/email/replyClassifier'

const prisma = new PrismaClient()

function parseFlags(argv: string[]) {
  const out = { days: 14, limit: Infinity, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--days') out.days = parseInt(argv[++i] || '14', 10) || 14
    else if (a === '--limit') out.limit = parseInt(argv[++i] || '0', 10) || Infinity
    else if (a === '--dry-run') out.dryRun = true
  }
  return out
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  const since = new Date(Date.now() - flags.days * 86_400_000)
  console.log(`[backfill-classify] window=${flags.days}d limit=${flags.limit === Infinity ? 'all' : flags.limit} dryRun=${flags.dryRun}`)

  const candidates = await prisma.emailMessage.findMany({
    where: {
      direction: 'inbound',
      duplicateOfId: null,
      replyClassification: null,
      sentAt: { gte: since },
      thread: { messageCount: { gt: 1 } },
      bodyText: { not: null },
    },
    select: { id: true, subject: true, bodyText: true, sentAt: true },
    orderBy: { sentAt: 'desc' },
    take: flags.limit === Infinity ? undefined : flags.limit,
  })
  console.log(`[backfill-classify] ${candidates.length} EmailMessages to classify`)

  let updated = 0
  let skipped = 0
  const dist: Record<string, number> = {}
  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i]
    if (!e.bodyText) { skipped++; continue }
    const result = await classifyReply({
      jobName: e.subject,
      subject: e.subject || '',
      bodyText: e.bodyText,
    })
    dist[result.classification] = (dist[result.classification] || 0) + 1
    if (!flags.dryRun) {
      await prisma.emailMessage.update({
        where: { id: e.id },
        data: {
          replyClassification: result.classification,
          replyClassificationConfidence: result.confidence,
        },
      })
    }
    updated++
    if (i % 10 === 0 && i > 0) {
      console.log(`[backfill-classify] progress ${i}/${candidates.length}`)
    }
  }

  console.log(`[backfill-classify] done. updated=${updated} skipped=${skipped}`)
  console.log(`[backfill-classify] distribution:`, dist)
}

main().catch((e) => { console.error('[backfill-classify] fatal:', e) }).finally(() => prisma.$disconnect())
