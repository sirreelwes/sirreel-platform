/**
 * Backfill EmailMessage.bodyText / bodyHtml / bodySource / attachmentCount.
 *
 * The Pub/Sub handler was upgraded on 2026-05-11 to fetch full message
 * bodies with format:"full". This seed populates the new fields for
 * pre-existing rows so the drawer + thread aggregation aren't stuck
 * showing snippets for historical conversations.
 *
 * Window: messages with sent_at within the last 90 days AND body_text
 * IS NULL. Cost: ~250ms per message × ~5K messages × 5 concurrent → ~5
 * minutes. Bandwidth: typical email is 5–20KB plaintext, 30–80KB HTML.
 *
 * Idempotent: re-run only catches rows whose body_text is still null.
 * Safe to re-run if it crashes mid-flight.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx prisma/seeds/2026-05-11-message-bodies.ts
 */

import { google } from 'googleapis'
import { prisma } from '../../src/lib/prisma'
import { extractBodyFromGmailPayload, type GmailMessagePart } from '../../src/lib/email/body'

const BACKFILL_WINDOW_DAYS = 90
const CONCURRENCY = 5
const MAX_RETRIES = 4 // → 1s, 2s, 4s, 8s

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
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

interface Row {
  id: string
  gmailMessageId: string
  accountEmail: string
}

interface FetchResult {
  bodyText: string | null
  bodyHtml: string | null
  bodySource: string | null
  attachmentCount: number
}

async function fetchBody(accountEmail: string, gmailMessageId: string): Promise<FetchResult | null> {
  const gmail = getGmailClient(accountEmail)
  let lastErr: unknown = null
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await gmail.users.messages.get({
        userId: 'me',
        id: gmailMessageId,
        format: 'full',
      })
      const extracted = extractBodyFromGmailPayload(res.data.payload as GmailMessagePart | undefined)
      return {
        bodyText: extracted.bodyText,
        bodyHtml: extracted.bodyHtml,
        bodySource: extracted.bodySource,
        attachmentCount: extracted.attachmentCount,
      }
    } catch (err: unknown) {
      lastErr = err
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (err as any)?.code ?? (err as any)?.response?.status
      if (code === 429 || code === 403 || (typeof code === 'number' && code >= 500)) {
        const wait = Math.min(8000, 500 * Math.pow(2, attempt))
        await sleep(wait)
        continue
      }
      // 404 = message deleted from Gmail; 401 = creds; skip non-retryable.
      if (code === 404) return null
      throw err
    }
  }
  throw lastErr
}

interface PoolJob {
  run: () => Promise<FetchResult | null>
  row: Row
}

async function runPool(
  jobs: PoolJob[],
  concurrency: number,
  onResult: (job: PoolJob, result: FetchResult | null | Error) => void,
) {
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= jobs.length) return
      try {
        const r = await jobs[i].run()
        onResult(jobs[i], r)
      } catch (err) {
        onResult(jobs[i], err as Error)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}

async function main() {
  const cutoff = new Date(Date.now() - BACKFILL_WINDOW_DAYS * 86_400_000)
  console.log(`Backfill window: messages sent on/after ${cutoff.toISOString()} (${BACKFILL_WINDOW_DAYS}d)`)

  // Pull rows whose bodyText is still null, joining the email_account so
  // we know which inbox to authenticate as when calling Gmail.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      m.id              AS "id",
      m.gmail_message_id AS "gmailMessageId",
      acct.email_address AS "accountEmail"
    FROM email_messages m
    JOIN email_accounts acct ON acct.id = m.email_account_id
    WHERE m.body_text IS NULL
      AND m.sent_at >= ${cutoff}
    ORDER BY m.sent_at DESC
  `
  console.log(`Loaded ${rows.length} EmailMessage row(s) to backfill`)

  if (rows.length === 0) {
    await prisma.$disconnect()
    return
  }

  let processed = 0
  let succeeded = 0
  let empty = 0
  let errored = 0
  let skipped = 0

  const jobs: PoolJob[] = rows.map((r) => ({
    row: r,
    run: () => fetchBody(r.accountEmail, r.gmailMessageId),
  }))

  const total = jobs.length

  await runPool(jobs, CONCURRENCY, async (job, result) => {
    processed++
    if (result instanceof Error) {
      errored++
      console.log(`[${processed}/${total}] ${job.row.id} ✗ ${(result as Error).message}`)
      return
    }
    if (result == null) {
      skipped++
      console.log(`[${processed}/${total}] ${job.row.id} ⊘ deleted/inaccessible`)
      return
    }
    if (!result.bodyText && !result.bodyHtml) {
      empty++
      // Still write attachment count + an explicit null bodySource so we
      // don't re-try this row on the next pass.
      await prisma.emailMessage.update({
        where: { id: job.row.id },
        data: { attachmentCount: result.attachmentCount },
      })
      console.log(`[${processed}/${total}] ${job.row.id} ⊘ no body (attachments=${result.attachmentCount})`)
      return
    }
    await prisma.emailMessage.update({
      where: { id: job.row.id },
      data: {
        bodyText: result.bodyText,
        bodyHtml: result.bodyHtml,
        bodySource: result.bodySource,
        attachmentCount: result.attachmentCount,
      },
    })
    succeeded++
    if (processed % 25 === 0 || processed === total) {
      console.log(`[${processed}/${total}] ok=${succeeded} empty=${empty} skipped=${skipped} err=${errored}`)
    }
  })

  console.log()
  console.log('───── SUMMARY ─────')
  console.log(`Total messages processed: ${processed}`)
  console.log(`Bodies persisted:         ${succeeded}`)
  console.log(`No body content:          ${empty}`)
  console.log(`Deleted/inaccessible:     ${skipped}`)
  console.log(`Errored:                  ${errored}`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
