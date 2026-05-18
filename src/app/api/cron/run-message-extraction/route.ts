import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runMessageExtractionForId } from '@/lib/ai/messageExtractor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BATCH_SIZE = 30
const LOOKBACK_DAYS = 60

/**
 * GET /api/cron/run-message-extraction
 *
 * Catch-up cron — runs every 5 minutes (vercel.json). Pulls up to 30
 * inbound EmailMessages from the last 60 days where extractionRunAt IS
 * NULL (and that aren't duplicates), and runs each through the Haiku
 * extractor.
 *
 * This is the GUARANTEE that "Extracting…" eventually resolves. The
 * pubsub/fetch/sync ingestion paths also kick off extraction
 * fire-and-forget for low latency on new mail, but Vercel may terminate
 * those background tasks before they finish — the cron is the safety net.
 *
 * Idempotent and rate-throttled by batch size. Failures are logged but
 * don't poison subsequent rows.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
  const due = await prisma.emailMessage.findMany({
    where: {
      direction: 'inbound',
      duplicateOfId: null,
      extractionRunAt: null,
      sentAt: { gte: since },
    },
    select: { id: true },
    orderBy: { sentAt: 'desc' },
    take: BATCH_SIZE,
  })

  let processed = 0
  let failed = 0
  for (const row of due) {
    try {
      const ok = await runMessageExtractionForId(row.id)
      if (ok) processed++
    } catch (err) {
      failed++
      console.error('[cron/run-message-extraction] failed for', row.id, err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({
    ok: true,
    queueDepth: due.length,
    processed,
    failed,
  })
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}
