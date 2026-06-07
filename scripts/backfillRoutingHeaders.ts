/**
 * Backfill routing-header capture for an existing inbox.
 *
 * For every EmailMessage on the target inbox where `routingHeaders IS NULL`,
 * re-fetch the Gmail payload (format=metadata, allow-listed headers) and
 * populate the column. Idempotent: re-running only touches the still-null
 * rows. Gmail messages that have since been deleted return 404 and are
 * skipped, not re-tried — they'd just 404 again next pass.
 *
 * Usage:
 *   npx tsx scripts/backfillRoutingHeaders.ts ana@sirreel.com [--limit 200]
 */

import './_loadProdEnv'
import { Prisma, PrismaClient } from '@prisma/client'
import { google } from 'googleapis'
import { extractRoutingHeaders, ROUTING_HEADER_NAMES } from '../src/lib/email/routingHeaders'

const prisma = new PrismaClient()

function getGmailClient(email: string) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}'
  const creds = JSON.parse(raw)
  const auth = new google.auth.JWT(
    creds.client_email,
    undefined,
    creds.private_key,
    ['https://www.googleapis.com/auth/gmail.readonly'],
    email,
  )
  return google.gmail({ version: 'v1', auth })
}

async function main() {
  const inbox = process.argv[2]
  if (!inbox) {
    console.error('Usage: tsx scripts/backfillRoutingHeaders.ts <inbox> [--limit N]')
    process.exit(1)
  }
  const limitIdx = process.argv.indexOf('--limit')
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1] || '0') : 0

  const account = await prisma.emailAccount.findUnique({ where: { emailAddress: inbox } })
  if (!account) {
    console.error(`No EmailAccount for ${inbox}`)
    process.exit(1)
  }

  const rows = await prisma.emailMessage.findMany({
    where: { emailAccountId: account.id, routingHeaders: { equals: Prisma.DbNull } },
    select: { id: true, gmailMessageId: true },
    orderBy: { sentAt: 'desc' },
    take: limit > 0 ? limit : undefined,
  })
  console.log(`[backfill] ${rows.length} rows pending for ${inbox}`)

  const gmail = getGmailClient(inbox)
  let updated = 0
  let skipped = 0
  let errors = 0
  for (const row of rows) {
    try {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: row.gmailMessageId,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', ...ROUTING_HEADER_NAMES],
      })
      const rh = extractRoutingHeaders(full.data.payload?.headers)
      if (!rh) { skipped++; continue }
      await prisma.emailMessage.update({
        where: { id: row.id },
        data: { routingHeaders: rh },
      })
      updated++
      if (updated % 25 === 0) console.log(`[backfill] ${updated}/${rows.length} updated...`)
    } catch (err: any) {
      const msg = err?.message || String(err)
      if (msg.includes('404') || msg.includes('Not Found')) {
        skipped++
        continue
      }
      console.warn(`[backfill] ${row.gmailMessageId} failed: ${msg}`)
      errors++
    }
  }
  console.log(`[backfill] done. updated=${updated} skipped=${skipped} errors=${errors}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
