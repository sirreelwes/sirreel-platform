/**
 * Backfill EmailThread.last{Inbound,Outbound}At + lastDirection.
 *
 * Two paths per thread:
 *   - Recent (lastMessageAt within 30 days): fetch the thread from Gmail,
 *     scan its messages, classify direction with the May 2026 helper, set
 *     real timestamps. Rate-limited to 5 concurrent calls with exponential
 *     backoff on 429.
 *   - Older than 30 days: assumed already handled. Set lastDirection =
 *     OUTBOUND with lastOutboundAt = lastMessageAt so they hide from the
 *     Inquiries list. No API call.
 *
 * Idempotent: re-running re-reads each thread and overwrites with the
 * same data. Safe.
 *
 * Run AFTER commit 1 has deployed to Vercel and you've confirmed an
 * outbound message lands in the DB with direction='outbound'.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx prisma/seeds/2026-05-10-inquiry-direction.ts
 */

import { google } from 'googleapis'
import { prisma } from '../../src/lib/prisma'
import { getMessageDirection } from '../../src/lib/email/direction'

const RECENT_WINDOW_DAYS = 30
const CONCURRENCY = 5
const MAX_RETRIES = 4 // → 1s, 2s, 4s, 8s

// Tiny per-call jitter on top of concurrency control to be polite.
function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

interface ThreadRow {
  id: string
  gmailThreadId: string
  subject: string
  lastMessageAt: Date
  // Email account to query Gmail with — derived from the most recent
  // EmailMessage on the thread (its emailAccount). Multiple agents may
  // be CC'd; we only need one with thread access.
  accountEmail: string | null
}

function getGmailClient(accountEmail: string) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}'
  const creds = JSON.parse(raw)
  if (!creds.client_email) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY missing client_email')
  const auth = new google.auth.JWT(
    creds.client_email,
    undefined,
    creds.private_key,
    ['https://www.googleapis.com/auth/gmail.readonly'],
    accountEmail,
  )
  return google.gmail({ version: 'v1', auth })
}

interface GmailLatest {
  fromHeader: string
  internalDate: number
}

async function fetchLatestForThread(
  accountEmail: string,
  gmailThreadId: string,
): Promise<GmailLatest | null> {
  const gmail = getGmailClient(accountEmail)
  let lastErr: unknown = null
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await gmail.users.threads.get({
        userId: 'me',
        id: gmailThreadId,
        format: 'metadata',
        metadataHeaders: ['From', 'Date'],
      })
      const messages = res.data.messages || []
      if (messages.length === 0) return null
      // Find max by internalDate.
      let best: GmailLatest | null = null
      for (const m of messages) {
        const ts = parseInt(m.internalDate || '0')
        const headers = m.payload?.headers || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const from = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value || ''
        if (!best || ts > best.internalDate) {
          best = { fromHeader: from, internalDate: ts }
        }
      }
      return best
    } catch (err: unknown) {
      lastErr = err
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (err as any)?.code ?? (err as any)?.response?.status
      if (code === 429 || code === 403 || (typeof code === 'number' && code >= 500)) {
        const wait = Math.min(8000, 500 * Math.pow(2, attempt))
        await sleep(wait)
        continue
      }
      // 404, 401, etc. — non-retryable.
      throw err
    }
  }
  throw lastErr
}

interface PoolJob<T> {
  run: () => Promise<T>
}

async function runPool<T>(jobs: PoolJob<T>[], concurrency: number, onResult: (i: number, r: T | Error) => void) {
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= jobs.length) return
      try {
        const r = await jobs[i].run()
        onResult(i, r)
      } catch (err) {
        onResult(i, err as Error)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}

async function main() {
  const cutoff = new Date(Date.now() - RECENT_WINDOW_DAYS * 86_400_000)
  console.log(`Backfill cutoff: ${cutoff.toISOString()} (${RECENT_WINDOW_DAYS}-day window)`)

  // 1. Pull all threads with a join to figure out which agent account to
  //    query Gmail with for each one.
  const threads = await prisma.$queryRaw<ThreadRow[]>`
    SELECT
      t.id                AS "id",
      t.gmail_thread_id   AS "gmailThreadId",
      t.subject           AS "subject",
      t.last_message_at   AS "lastMessageAt",
      (
        SELECT acct.email_address
        FROM email_messages m
        JOIN email_accounts acct ON acct.id = m.email_account_id
        WHERE m.thread_id = t.id
        ORDER BY m.sent_at DESC
        LIMIT 1
      )                   AS "accountEmail"
    FROM email_threads t
    ORDER BY t.last_message_at DESC NULLS LAST
  `
  console.log(`Loaded ${threads.length} EmailThread rows`)

  const recent = threads.filter((t) => t.lastMessageAt && new Date(t.lastMessageAt) >= cutoff)
  const old = threads.filter((t) => !t.lastMessageAt || new Date(t.lastMessageAt) < cutoff)
  console.log(`  Recent (≤${RECENT_WINDOW_DAYS}d, will hit Gmail API): ${recent.length}`)
  console.log(`  Old (>${RECENT_WINDOW_DAYS}d, assumed handled): ${old.length}`)

  // 2. Old threads — assume already handled. Set lastDirection=OUTBOUND and
  //    lastOutboundAt=lastMessageAt so they drop off the Inquiries list.
  let assumedDone = 0
  for (const t of old) {
    if (!t.lastMessageAt) continue
    await prisma.emailThread.update({
      where: { id: t.id },
      data: {
        lastDirection: 'OUTBOUND',
        lastOutboundAt: t.lastMessageAt,
      },
    })
    assumedDone++
  }
  console.log(`✓ Assumed-handled: ${assumedDone} thread(s) marked OUTBOUND.`)

  // 3. Recent threads — fetch Gmail thread metadata, classify, persist.
  const total = recent.length
  let inbound = 0
  let outbound = 0
  let skippedNoAccount = 0
  let errored = 0

  const jobs: PoolJob<{ thread: ThreadRow; latest: GmailLatest | null }>[] = recent.map((t) => ({
    run: async () => {
      if (!t.accountEmail) return { thread: t, latest: null }
      const latest = await fetchLatestForThread(t.accountEmail, t.gmailThreadId)
      return { thread: t, latest }
    },
  }))

  let processed = 0
  await runPool(jobs, CONCURRENCY, (i, result) => {
    processed++
    const t = recent[i]
    if (result instanceof Error) {
      errored++
      console.log(`[${processed}/${total}] thread ${t.id} ✗ ${(result as Error).message}`)
      return
    }
    const { latest } = result
    if (!t.accountEmail) {
      skippedNoAccount++
      console.log(`[${processed}/${total}] thread ${t.id} ⊘ no account (orphan messages)`)
      // Best-effort: assume handled so it hides.
      void prisma.emailThread.update({
        where: { id: t.id },
        data: { lastDirection: 'OUTBOUND', lastOutboundAt: t.lastMessageAt },
      })
      return
    }
    if (!latest) {
      // Thread exists in our DB but Gmail returned no messages — treat as
      // handled.
      void prisma.emailThread.update({
        where: { id: t.id },
        data: { lastDirection: 'OUTBOUND', lastOutboundAt: t.lastMessageAt },
      })
      console.log(`[${processed}/${total}] thread ${t.id} ⊘ Gmail returned 0 msgs`)
      return
    }
    const dir = getMessageDirection(latest.fromHeader)
    const ts = new Date(latest.internalDate)
    if (dir === 'INBOUND') inbound++
    else outbound++
    void prisma.emailThread.update({
      where: { id: t.id },
      data: {
        lastDirection: dir,
        ...(dir === 'INBOUND' ? { lastInboundAt: ts } : { lastOutboundAt: ts }),
      },
    })
    console.log(`[${processed}/${total}] thread ${t.id} → ${dir}  (${ts.toISOString()})`)
  })

  console.log()
  console.log('───── SUMMARY ─────')
  console.log(`Total threads:        ${threads.length}`)
  console.log(`Real-data backfill:   ${inbound + outbound}  (INBOUND ${inbound} / OUTBOUND ${outbound})`)
  console.log(`Assumed-handled:      ${assumedDone}`)
  console.log(`Orphan/empty:         ${skippedNoAccount}`)
  console.log(`Errored:              ${errored}`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
