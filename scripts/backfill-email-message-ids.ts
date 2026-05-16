#!/usr/bin/env tsx
/**
 * One-time backfill that populates EmailMessage.rfc822MessageId +
 * EmailMessage.inReplyTo from the Gmail API and then links cross-inbox
 * duplicates via EmailMessage.duplicateOfId.
 *
 * Why both passes:
 *   1. Pre-May-2026 EmailMessages were ingested without ever reading the
 *      RFC 822 Message-Id header — the field is null for every historical
 *      row. We fetch metadata for each row to backfill.
 *   2. Once Message-Id is on every row, group by it: the oldest createdAt
 *      stays canonical, every other inbox copy gets duplicateOfId pointing
 *      at the canonical row. The Inquiries query filters duplicateOfId=null
 *      after this runs, eliminating the cross-inbox duplicates seen on the
 *      Under Pressure / Watchmakers / Hospital Set threads.
 *
 * Idempotent: re-running only touches rows where rfc822MessageId is still
 * null (pass 1) or where the duplicateOfId pointer is missing/stale (pass 2).
 *
 * Run with:
 *   npx tsx scripts/backfill-email-message-ids.ts             # process all
 *   npx tsx scripts/backfill-email-message-ids.ts --limit 100 # cap pass 1
 *   npx tsx scripts/backfill-email-message-ids.ts --dedup-only
 */

import { google } from 'googleapis'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SLEEP_MS_BETWEEN_FETCHES = 50 // Gmail metadata.get is cheap, but stay polite

function parseFlags(argv: string[]) {
  const out = { limit: Infinity, dedupOnly: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--limit') out.limit = parseInt(argv[++i] || '0', 10) || Infinity
    else if (a === '--dedup-only') out.dedupOnly = true
    else if (a === '--dry-run') out.dryRun = true
  }
  return out
}

function getGmailClient(email: string) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}'
  const creds = JSON.parse(raw)
  if (!creds.client_email) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY missing or malformed')
  const auth = new google.auth.JWT(
    creds.client_email,
    undefined,
    creds.private_key,
    ['https://www.googleapis.com/auth/gmail.readonly'],
    email,
  )
  return google.gmail({ version: 'v1', auth })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function backfillMessageIds(limit: number, dryRun: boolean): Promise<{ updated: number; skipped: number; failed: number }> {
  const accounts = await prisma.emailAccount.findMany({ select: { id: true, emailAddress: true } })
  const accountByAddress = new Map(accounts.map((a) => [a.id, a.emailAddress] as const))

  const rows = await prisma.emailMessage.findMany({
    where: { rfc822MessageId: null },
    select: { id: true, gmailMessageId: true, emailAccountId: true },
    orderBy: { sentAt: 'desc' },
    take: limit === Infinity ? undefined : limit,
  })
  console.log(`[backfill] pass 1: ${rows.length} EmailMessages with null rfc822MessageId`)

  const clientByAccount = new Map<string, ReturnType<typeof getGmailClient>>()
  let updated = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const email = accountByAddress.get(row.emailAccountId)
    if (!email) {
      skipped++
      continue
    }
    let gmail = clientByAccount.get(email)
    if (!gmail) {
      gmail = getGmailClient(email)
      clientByAccount.set(email, gmail)
    }

    try {
      const res = await gmail.users.messages.get({
        userId: 'me',
        id: row.gmailMessageId,
        format: 'metadata',
        metadataHeaders: ['Message-ID', 'In-Reply-To'],
      })
      const headers = res.data.payload?.headers || []
      const get = (n: string) => headers.find((h: any) => h.name?.toLowerCase() === n.toLowerCase())?.value || null
      const rfc822MessageId = get('Message-ID') || get('Message-Id') || null
      const inReplyTo = get('In-Reply-To') || null
      if (!rfc822MessageId) {
        skipped++
      } else if (!dryRun) {
        await prisma.emailMessage.update({
          where: { id: row.id },
          data: { rfc822MessageId, inReplyTo },
        })
        updated++
      } else {
        updated++
      }
    } catch (err: any) {
      // 404s are expected (message was deleted in Gmail); other errors are logged
      if (err?.code !== 404 && err?.response?.status !== 404) {
        console.error(`[backfill] gmail.get failed for ${row.gmailMessageId} in ${email}:`, err?.message || err)
      }
      failed++
    }
    if (i % 50 === 0 && i > 0) {
      console.log(`[backfill]   progress ${i}/${rows.length} (updated=${updated} skipped=${skipped} failed=${failed})`)
    }
    if (SLEEP_MS_BETWEEN_FETCHES > 0) await sleep(SLEEP_MS_BETWEEN_FETCHES)
  }
  console.log(`[backfill] pass 1 done: updated=${updated} skipped=${skipped} failed=${failed}`)
  return { updated, skipped, failed }
}

async function dedupByMessageId(dryRun: boolean): Promise<{ linked: number; groups: number }> {
  // Group EmailMessages by rfc822MessageId, oldest createdAt wins.
  const rows = await prisma.emailMessage.findMany({
    where: { rfc822MessageId: { not: null } },
    select: { id: true, rfc822MessageId: true, createdAt: true, duplicateOfId: true },
    orderBy: { createdAt: 'asc' },
  })
  const groups = new Map<string, { id: string; createdAt: Date; duplicateOfId: string | null }[]>()
  for (const r of rows) {
    const key = r.rfc822MessageId!
    const list = groups.get(key) || []
    list.push({ id: r.id, createdAt: r.createdAt, duplicateOfId: r.duplicateOfId })
    groups.set(key, list)
  }

  let dupGroups = 0
  let linked = 0
  for (const [_, list] of groups) {
    if (list.length < 2) continue
    dupGroups++
    const [canonical, ...rest] = list // already sorted asc → canonical is oldest
    for (const dup of rest) {
      if (dup.duplicateOfId === canonical.id) continue
      if (!dryRun) {
        await prisma.emailMessage.update({
          where: { id: dup.id },
          data: { duplicateOfId: canonical.id },
        })
      }
      linked++
    }
  }
  console.log(`[backfill] pass 2 done: dup_groups=${dupGroups} rows_linked=${linked}`)
  return { linked, groups: dupGroups }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  console.log(
    `[backfill] starting (limit=${flags.limit === Infinity ? 'all' : flags.limit}, dedupOnly=${flags.dedupOnly}, dryRun=${flags.dryRun})`,
  )
  try {
    if (!flags.dedupOnly) {
      await backfillMessageIds(flags.limit, flags.dryRun)
    }
    await dedupByMessageId(flags.dryRun)
  } finally {
    await prisma.$disconnect()
  }
  console.log('[backfill] done.')
}

main().catch((err) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
