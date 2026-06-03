import { prisma } from '@/lib/prisma'
import type { GmailIngestionHealth } from './types'

/**
 * Gmail ingestion dead-man's-switch.
 *
 * Two failure modes we want to catch BEFORE the sales team notices a
 * silent Pipeline:
 *
 *   (a) Watch lapse — Gmail Pub/Sub watch() has a 7-day TTL. If the
 *       daily renewal cron at /api/gmail/watch stops succeeding,
 *       lastWatchedAt goes stale and notifications stop firing. The
 *       Pub/Sub handler keeps returning 200 to Google's empty
 *       deliveries; nothing throws. Silent. We watch lastWatchedAt
 *       per inbox and fire DEGRADED at >6 days, DOWN at >7 days.
 *
 *   (b) High-volume inbox quiet — jose@ and oliver@ ingest hundreds
 *       of inbound per week (June 2026 baseline: 600+/wk on jose@,
 *       450+/wk on oliver@). Zero inbound on those for 24 hours is
 *       a real signal that something between Gmail and our DB is
 *       broken even if the watch is "alive." Skip info@ and ana@ —
 *       both legitimately go days at a stretch with no inbound, so
 *       a 24h check there would just be channel noise.
 *
 * Returns one rolled-up status for the service and per-inbox detail
 * the admin UI can render.
 */

const HIGH_VOLUME_INBOXES = ['jose@sirreel.com', 'oliver@sirreel.com']
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const APPROACHING_TTL_MS = 6 * 24 * 60 * 60 * 1000
const HIGH_VOLUME_QUIET_MS = 24 * 60 * 60 * 1000

export async function checkGmailIngestion(): Promise<GmailIngestionHealth> {
  const lastChecked = new Date().toISOString()
  const start = Date.now()
  try {
    const accounts = await prisma.emailAccount.findMany({
      where: { isActive: true },
      select: { id: true, emailAddress: true, lastWatchedAt: true },
      orderBy: { emailAddress: 'asc' },
    })
    if (accounts.length === 0) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: 'No active EmailAccount rows — nothing to watch',
        inboxes: [],
        lastChecked,
      }
    }

    const now = Date.now()
    const errors: string[] = []
    let worst: 'healthy' | 'degraded' | 'down' = 'healthy'
    const inboxes: GmailIngestionHealth['inboxes'] = []

    for (const acct of accounts) {
      const lastWatchedAt = acct.lastWatchedAt
      const ageMs = lastWatchedAt ? now - lastWatchedAt.getTime() : null
      let watchStatus: 'healthy' | 'degraded' | 'down' = 'healthy'
      let watchNote: string | null = null
      if (ageMs === null) {
        // Column is freshly added — backfill puts NOW for all active
        // accounts. A NULL after backfill means the row was created
        // since and the cron hasn't yet renewed it. Treat as degraded
        // (not down) for the first 24h so a new inbox doesn't page.
        watchStatus = 'degraded'
        watchNote = 'lastWatchedAt is null — never renewed'
      } else if (ageMs > TTL_MS) {
        watchStatus = 'down'
        watchNote = `lastWatchedAt is ${(ageMs / 86_400_000).toFixed(1)}d ago — TTL exceeded`
      } else if (ageMs > APPROACHING_TTL_MS) {
        watchStatus = 'degraded'
        watchNote = `lastWatchedAt is ${(ageMs / 86_400_000).toFixed(1)}d ago — within 24h of TTL`
      }

      // High-volume quiet check — only on jose@ / oliver@.
      let quietStatus: 'healthy' | 'degraded' | 'down' = 'healthy'
      let quietNote: string | null = null
      let lastInboundAt: Date | null = null
      if (HIGH_VOLUME_INBOXES.includes(acct.emailAddress)) {
        const latest = await prisma.emailMessage.findFirst({
          where: { emailAccountId: acct.id, direction: 'inbound' },
          select: { sentAt: true },
          orderBy: { sentAt: 'desc' },
        })
        lastInboundAt = latest?.sentAt ?? null
        if (!lastInboundAt) {
          quietStatus = 'degraded'
          quietNote = 'no inbound ever recorded on a high-volume inbox'
        } else if (now - lastInboundAt.getTime() > HIGH_VOLUME_QUIET_MS) {
          const hrs = ((now - lastInboundAt.getTime()) / 3_600_000).toFixed(1)
          quietStatus = 'degraded'
          quietNote = `no inbound for ${hrs}h on a high-volume inbox`
        }
      }

      const inboxStatus: 'healthy' | 'degraded' | 'down' =
        watchStatus === 'down'
          ? 'down'
          : watchStatus === 'degraded' || quietStatus === 'degraded'
            ? 'degraded'
            : 'healthy'

      if (inboxStatus === 'down' || inboxStatus === 'degraded') {
        if (watchNote) errors.push(`${acct.emailAddress}: ${watchNote}`)
        if (quietNote) errors.push(`${acct.emailAddress}: ${quietNote}`)
      }

      if (inboxStatus === 'down') worst = 'down'
      else if (inboxStatus === 'degraded' && worst !== 'down') worst = 'degraded'

      inboxes.push({
        emailAddress: acct.emailAddress,
        lastWatchedAt: lastWatchedAt?.toISOString() ?? null,
        lastInboundAt: lastInboundAt?.toISOString() ?? null,
        status: inboxStatus,
        note: watchNote ?? quietNote ?? null,
      })
    }

    return {
      status: worst,
      latencyMs: Date.now() - start,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      inboxes,
      lastChecked,
    }
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      inboxes: [],
      lastChecked,
    }
  }
}
