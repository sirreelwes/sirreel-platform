#!/usr/bin/env tsx
/**
 * Re-runs AI extraction over inbound EmailMessage rows in the current
 * 14-day Pipeline window (regardless of whether they were extracted before).
 * Used when the extractor prompt or schema changes and we need the current
 * Pipeline view to reflect the new behavior without backfilling the full
 * historical inbox.
 *
 * Writes extractedData / extractionRunAt / extractionConfidence in place.
 * No category re-stamp — the Pipeline route gates on messageNature directly.
 *
 *   npx tsx scripts/reextract-pipeline-window.ts --dry-run
 *   npx tsx scripts/reextract-pipeline-window.ts
 *   npx tsx scripts/reextract-pipeline-window.ts --days 7
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
const DEFAULT_CONCURRENCY = 10

function parseFlags(argv: string[]) {
  const out = {
    days: 14,
    dryRun: false,
    limit: Infinity,
    concurrency: DEFAULT_CONCURRENCY,
    skipRecentMinutes: 0,
    allInbound: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--days') out.days = parseInt(argv[++i] || '14', 10) || 14
    else if (a === '--limit') out.limit = parseInt(argv[++i] || '0', 10) || Infinity
    else if (a === '--concurrency') out.concurrency = parseInt(argv[++i] || '10', 10) || 10
    else if (a === '--skip-recent') out.skipRecentMinutes = parseInt(argv[++i] || '60', 10) || 60
    else if (a === '--all-inbound') out.allInbound = true
    else if (a === '--dry-run') out.dryRun = true
  }
  return out
}

async function abortIfExtractorBroken() {
  const probe = await extractMessageData({
    subject: 'Quote request',
    fromAddress: 'test@example.com',
    bodyText: 'Hi, we need a cargo van for a one-day shoot in Burbank on June 1. Thanks, Sam',
    snippet: null,
  })
  if (probe.confidence <= 0) {
    console.error('[reextract] STARTUP PROBE FAILED — extractor returned confidence 0. Aborting.')
    process.exit(1)
  }
  console.log(`[reextract] probe ok (nature=${probe.messageNature} conf=${probe.confidence})`)
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  const since = new Date(Date.now() - flags.days * 86_400_000)
  const skipBefore = flags.skipRecentMinutes > 0
    ? new Date(Date.now() - flags.skipRecentMinutes * 60_000)
    : null
  console.log(
    `[reextract] window=${flags.days}d dryRun=${flags.dryRun} concurrency=${flags.concurrency} skipRecent=${flags.skipRecentMinutes}min`,
  )

  if (!flags.dryRun) await abortIfExtractorBroken()

  const candidates = await prisma.emailMessage.findMany({
    where: {
      direction: 'inbound',
      duplicateOfId: null,
      sentAt: { gte: since },
      // Default scope: only rows the Pipeline view actually surfaces.
      // Those are the only ones that can hold a false-positive 'inquiry'
      // tag, so re-extracting more is wasted API calls. Pass --all-inbound
      // to widen to every inbound row in the window.
      ...(flags.allInbound
        ? {}
        : {
            extractedData: { path: ['messageNature'], equals: 'inquiry' },
            extractionConfidence: { gt: 0 },
          }),
      AND: [
        { OR: [{ bodyText: { not: null } }, { snippet: { not: null } }] },
        ...(skipBefore
          ? [{ OR: [{ extractionRunAt: null }, { extractionRunAt: { lt: skipBefore } }] }]
          : []),
      ],
    },
    select: { id: true, subject: true, fromAddress: true, bodyText: true, bodyHtml: true, snippet: true },
    orderBy: { sentAt: 'desc' },
    take: flags.limit === Infinity ? undefined : flags.limit,
  })
  console.log(`[reextract] ${candidates.length} EmailMessages to (re-)extract`)

  const natureDist: Record<string, number> = {}
  let updated = 0
  const total = candidates.length
  let nextIdx = 0

  const workOne = async (): Promise<void> => {
    while (true) {
      const idx = nextIdx++
      if (idx >= total) return
      const e = candidates[idx]
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
      if (updated % 100 === 0) {
        console.log(`[reextract] progress ${updated}/${total} | dist:`, natureDist)
      }
    }
  }

  await Promise.all(Array.from({ length: flags.concurrency }, () => workOne()))

  console.log(`[reextract] done. updated=${updated}`)
  console.log('[reextract] final nature distribution:', natureDist)
}

main().catch((e) => console.error('[reextract] fatal:', e)).finally(() => prisma.$disconnect())
