/**
 * Stage B of the CRM enrichment — harvest the To/CC lines of production
 * email.
 *
 * Wes, 2026-08-26: "if contacts are cc'd on a production email from
 * another client, they are worth capturing and classifying as a
 * production contact."
 *
 * The capture pipeline only ever read the SENDER. On a film production
 * the CC line IS the production team — UPM, coordinator, transpo,
 * locations — so every one of those threads has been carrying contacts
 * past us unharvested.
 *
 * Source set: messages that already produced an AUTO_CAPTURED
 * InquiryCapture. That verdict is the pipeline's own judgement that the
 * thread is legitimate production mail; this script inherits it rather
 * than re-deciding. Nothing outside that set is touched, which also
 * keeps the run inside the sanctioned inboxes (info@/jose@/oliver@) —
 * dani@/hello@/studios@ stay out of scope per Wes, 2026-08-26.
 *
 * Rules and thresholds live in src/lib/crm/recipientHarvest.ts. The
 * short version:
 *   - internal (sirreel.com AND sirreel.us), role mailboxes
 *     (locations@, bookings@…), automated senders and known vendor
 *     domains are all dropped
 *   - freemail is KEPT — a producer on gmail is still a producer
 *   - an address must appear on >= 2 DISTINCT threads to auto-file;
 *     single-thread addresses are reported for review instead
 *
 * Role is NOT inferred. A CC line carries a name and an address, never
 * a signature block, so contacts land as role=OTHER with
 * source='email_cc_capture'. Their title gets filled in later by mail
 * they actually send, or by the AI pass. Guessing "UPM" off a CC line
 * would put fiction into the field sales targets on.
 *
 * Safety:
 *   - Dry run by default; --write applies.
 *   - Only CREATES people who do not already exist (matched by email,
 *     alias-aware via resolvePersonByEmail). Never edits an existing
 *     contact — an established record beats a CC-line guess.
 *   - --write records every created id to tmp/cc-capture-<stamp>.json
 *     so the run is reversible BY CAPTURED ID.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/backfillCcContacts.ts                  # dry run
 *   npx tsx scripts/backfillCcContacts.ts --threshold 3    # stricter
 *   npx tsx scripts/backfillCcContacts.ts --write          # apply
 */

import './_loadProdEnv'
import { PrismaClient, PersonRole } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'node:fs'
import {
  harvestRecipients,
  partitionByConfidence,
  DEFAULT_THREAD_THRESHOLD,
  type HarvestSource,
} from '../src/lib/crm/recipientHarvest'
import { normalizeEmail } from '../src/lib/people/email'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')
const tArg = process.argv.indexOf('--threshold')
const THRESHOLD = tArg >= 0 ? Number(process.argv[tArg + 1]) : DEFAULT_THREAD_THRESHOLD

const BATCH = 2000

async function main() {
  console.log(WRITE ? '=== APPLYING ===' : '=== DRY RUN (pass --write to apply) ===')
  console.log(`Thread threshold: ${THRESHOLD}\n`)

  const caps = await prisma.inquiryCapture.findMany({
    where: { verdict: 'AUTO_CAPTURED' },
    select: { emailMessageId: true },
  })
  const messageIds = caps.map((c) => c.emailMessageId).filter(Boolean) as string[]
  console.log(`Production-legitimate messages to mine: ${messageIds.length}`)

  const sources: HarvestSource[] = []
  for (let i = 0; i < messageIds.length; i += BATCH) {
    const rows = await prisma.emailMessage.findMany({
      where: { id: { in: messageIds.slice(i, i + BATCH) } },
      select: { id: true, threadId: true, toAddresses: true, routingHeaders: true },
    })
    for (const m of rows) {
      const rh = (m.routingHeaders ?? {}) as Record<string, unknown>
      sources.push({
        // Count per THREAD, not per message — one booking thread with
        // 30 replies must not promote its CC list to "seen 30 times".
        threadKey: m.threadId ?? m.id,
        toAddresses: m.toAddresses,
        cc: rh.cc,
        to: rh.to,
      })
    }
  }

  const harvested = harvestRecipients(sources)
  console.log(`Distinct addresses after guards: ${harvested.size}`)

  // Which are already contacts? Alias-aware would be ideal but this is
  // a bulk pass — a direct email index is the cheap 99% answer, and any
  // alias collision surfaces as a unique-constraint failure on create,
  // which is counted, not fatal.
  const emails = [...harvested.keys()]
  const known = new Set<string>()
  for (let i = 0; i < emails.length; i += 1000) {
    const rows = await prisma.person.findMany({
      where: { email: { in: emails.slice(i, i + 1000) } },
      select: { email: true },
    })
    rows.forEach((r) => known.add(r.email.toLowerCase()))
  }
  const aliases = await prisma.personEmailAlias.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  })
  aliases.forEach((a) => known.add(a.email.toLowerCase()))

  const novel = [...harvested.values()].filter((r) => !known.has(r.email))
  const { autoFile, review } = partitionByConfidence(novel, THRESHOLD)

  console.log(`  already contacts:        ${harvested.size - novel.length}`)
  console.log(`  new                      ${novel.length}`)
  console.log(`    ├─ >= ${THRESHOLD} threads (auto-file): ${autoFile.length}`)
  console.log(`    └─ below threshold (review): ${review.length}`)

  const named = autoFile.filter((r) => r.name).length
  console.log(`\n  of the auto-file set, ${named} carry a real display name`)
  console.log(`  ${autoFile.length - named} would land as "Unknown" — those are SKIPPED,`)
  console.log('  a nameless contact is not something sales can address.\n')

  const fileable = autoFile.filter((r) => r.name)

  console.log('TOP OF THE AUTO-FILE SET')
  fileable.slice(0, 20).forEach((r) =>
    console.log(`  ${String(r.threadCount).padStart(3)} threads  ${(r.name ?? '').padEnd(26)} ${r.email}`),
  )

  console.log('\nBELOW THRESHOLD — not filed, listed so the cut is visible')
  review.slice(0, 10).forEach((r) =>
    console.log(`  ${String(r.threadCount).padStart(3)} threads  ${(r.name ?? '—').padEnd(26)} ${r.email}`),
  )

  if (!WRITE) {
    console.log(`\nDry run complete. Re-run with --write to create ${fileable.length} contacts.`)
    return
  }

  const createdIds: string[] = []
  let failed = 0
  for (const r of fileable) {
    const parts = (r.name ?? '').trim().split(/\s+/)
    const firstName = parts[0] ?? 'Unknown'
    const lastName = parts.slice(1).join(' ') || ''
    try {
      const row = await prisma.person.create({
        data: {
          firstName,
          lastName,
          email: normalizeEmail(r.email),
          role: PersonRole.OTHER,
          source: 'email_cc_capture',
          notes: `Harvested from the To/CC line of ${r.threadCount} production threads (${new Date().toISOString().slice(0, 10)}). Role not yet known — no signature block on a CC line.`,
        },
        select: { id: true },
      })
      createdIds.push(row.id)
    } catch (err) {
      failed += 1
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('Unique constraint')) {
        console.error(`  FAILED ${r.email}: ${msg.split('\n')[0]}`)
      }
    }
  }

  mkdirSync('tmp', { recursive: true })
  const path = `tmp/cc-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(path, JSON.stringify({ createdPersonIds: createdIds }, null, 2))
  console.log(`\nCreated ${createdIds.length} contacts (${failed} skipped/failed).`)
  console.log(`Reversal list: ${path} — delete BY THESE IDS ONLY if this needs undoing.`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
