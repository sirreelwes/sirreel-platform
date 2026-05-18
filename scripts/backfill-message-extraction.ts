#!/usr/bin/env tsx
/**
 * Backfill per-message AI extraction for historical inbound emails. Pulls
 * rows where extractionRunAt is NULL (and direction='inbound', duplicateOfId
 * null, within the lookback window), runs them through the Haiku extractor,
 * and persists the result. Rate-limited to ~5 req/sec so we don't bombard
 * the Anthropic API.
 *
 * Per CRH spec: skip messages older than 90 days during backfill — the API
 * cost outweighs the value for stale inbox data.
 *
 *   npx tsx scripts/backfill-message-extraction.ts                # last 60 days
 *   npx tsx scripts/backfill-message-extraction.ts --days 30      # custom window
 *   npx tsx scripts/backfill-message-extraction.ts --limit 50     # cap batch
 *   npx tsx scripts/backfill-message-extraction.ts --dry-run      # no writes
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import path from 'path'

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

import { extractMessageData } from '../src/lib/ai/messageExtractor'

const prisma = new PrismaClient()
const MAX_AGE_DAYS = 90
const RATE_PER_SEC = 5
const SLEEP_MS = 1000 / RATE_PER_SEC

function parseFlags(argv: string[]) {
  const out = { days: 60, limit: Infinity, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--days') out.days = parseInt(argv[++i] || '60', 10) || 60
    else if (a === '--limit') out.limit = parseInt(argv[++i] || '0', 10) || Infinity
    else if (a === '--dry-run') out.dryRun = true
  }
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Startup probe — calls extractMessageData on a tiny synthetic input and
 * aborts the run if confidence comes back 0 (the FALLBACK signature). This
 * is the guardrail for the May 2026 incident where the script ran for 37
 * min and wrote 5,628 FALLBACK rows because the local Anthropic client
 * had been constructed before .env.local was loaded. Now: if the probe
 * fails, the script exits without touching the DB.
 */
async function abortIfExtractorBroken() {
  const probe = await extractMessageData({
    subject: 'Quote request',
    fromAddress: 'test@example.com',
    bodyText: 'Hi, we need a cargo van for a one-day shoot in Burbank on June 1. Thanks, Sam',
    snippet: null,
  })
  if (probe.confidence <= 0) {
    console.error(
      '[backfill-extract] STARTUP PROBE FAILED: extractMessageData returned confidence 0 (FALLBACK shape).',
    )
    console.error('[backfill-extract] This means the Anthropic client cannot reach the API.')
    console.error('[backfill-extract] Common causes: missing ANTHROPIC_API_KEY in env at module-load time,')
    console.error('[backfill-extract] malformed key value, model ID unavailable, network blocked.')
    console.error('[backfill-extract] Aborting without writing any rows.')
    process.exit(1)
  }
  console.log(`[backfill-extract] startup probe ok (confidence=${probe.confidence}, summary="${probe.summary.slice(0, 60)}")`)
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  // Enforce the hard cap so a stray --days 9999 doesn't drain the wallet.
  const days = Math.min(flags.days, MAX_AGE_DAYS)
  const since = new Date(Date.now() - days * 86_400_000)
  console.log(
    `[backfill-extract] window=${days}d limit=${flags.limit === Infinity ? 'all' : flags.limit} dryRun=${flags.dryRun}`,
  )

  if (!flags.dryRun) {
    await abortIfExtractorBroken()
  }

  const candidates = await prisma.emailMessage.findMany({
    where: {
      direction: 'inbound',
      duplicateOfId: null,
      extractionRunAt: null,
      sentAt: { gte: since },
      OR: [{ bodyText: { not: null } }, { snippet: { not: null } }],
    },
    select: {
      id: true,
      subject: true,
      fromAddress: true,
      bodyText: true,
      bodyHtml: true,
      snippet: true,
    },
    orderBy: { sentAt: 'desc' },
    take: flags.limit === Infinity ? undefined : flags.limit,
  })
  console.log(`[backfill-extract] ${candidates.length} EmailMessages to extract`)

  let updated = 0
  const natureDist: Record<string, number> = {}
  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i]
    const extracted = await extractMessageData({
      subject: e.subject,
      fromAddress: e.fromAddress,
      bodyText: e.bodyText,
      bodyHtml: e.bodyHtml,
      snippet: e.snippet,
    })
    natureDist[extracted.messageNature] = (natureDist[extracted.messageNature] || 0) + 1
    if (!flags.dryRun) {
      await prisma.emailMessage.update({
        where: { id: e.id },
        data: {
          extractedData: extracted as unknown as object,
          extractionRunAt: new Date(),
          extractionConfidence: extracted.confidence,
        },
      })
    }
    updated++
    if (i % 10 === 0 && i > 0) {
      console.log(`[backfill-extract] progress ${i}/${candidates.length}`)
    }
    await sleep(SLEEP_MS)
  }

  console.log(`[backfill-extract] done. updated=${updated}`)
  console.log(`[backfill-extract] nature distribution:`, natureDist)
}

main().catch((e) => console.error('[backfill-extract] fatal:', e)).finally(() => prisma.$disconnect())
