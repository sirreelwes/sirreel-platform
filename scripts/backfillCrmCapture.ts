/**
 * 12-month CRM capture backfill — runs the live capture pipeline
 * (src/lib/crm/captureFromEmail.ts) over historical INBOUND mail on
 * info@/jose@/oliver@ that hasn't been processed yet.
 *
 * Scope:
 *   - direction = 'inbound'
 *   - sentAt within the last 12 months
 *   - emailAccount.emailAddress ∈ {info@, jose@, oliver@}
 *   - duplicateOfId is null (canonical copy only)
 *   - NOT EXISTS InquiryCapture for this EmailMessage (idempotent —
 *     re-running picks up where the last run stopped)
 *
 * Calibration gate (default ON):
 *   process 200 messages, STOP, print
 *     - verdict distribution
 *     - 10 sample AUTO captures with extracted fields
 *     - 5 sample SKIPs with reasons
 *   then exit so Wes can eyeball. Pass --continue to run unattended
 *   (skips the gate). --limit N caps the run at N messages (handy for
 *   quick smoke-tests).
 *
 * Throttling: Haiku extraction is gated to ~5 req/sec (200ms between
 * calls). captureFromEmail itself does no extra LLM work — it reads
 * the cached extractedData.
 *
 * Final report (printed when the run ends, calibration or otherwise):
 *   - totals: processed / AUTO / REVIEW / SKIPPED / errors
 *   - enriched-existing count (resolution=AUTO_ENRICHED)
 *   - role distribution from this run
 *   - top 20 captured company strings with NO CRM company match —
 *     candidates for manual CRM-company creation
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   export ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' .env.local | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/backfillCrmCapture.ts            # calibration gate
 *   npx tsx scripts/backfillCrmCapture.ts --continue # unattended full run
 *   npx tsx scripts/backfillCrmCapture.ts --limit 50 # smoke test
 */

import './_loadProdEnv'
import { PrismaClient, CaptureVerdict, CaptureResolution, PersonRole } from '@prisma/client'
import { runMessageExtractionForId } from '../src/lib/ai/messageExtractor'
import { captureFromEmail } from '../src/lib/crm/captureFromEmail'

const p = new PrismaClient()

const SALES_INBOXES = ['info@sirreel.com', 'jose@sirreel.com', 'oliver@sirreel.com']
const CALIBRATION_LIMIT = 200
const HAIKU_THROTTLE_MS = 200 // ~5 req/sec
const BATCH_SIZE = 50         // pull this many candidates at a time

interface RunStats {
  processed: number
  auto: number
  review: number
  skipped: number
  duplicate: number
  errors: number
  enrichedExisting: number    // AUTO captures that resolved to AUTO_ENRICHED
  filedNew: number            // AUTO captures that resolved to AUTO_FILED
  haikuCalls: number
}

const stats: RunStats = {
  processed: 0,
  auto: 0,
  review: 0,
  skipped: 0,
  duplicate: 0,
  errors: 0,
  enrichedExisting: 0,
  filedNew: 0,
  haikuCalls: 0,
}

// Sample buckets for the calibration report.
interface AutoSample {
  emailMessageId: string
  inbox: string
  fromAddress: string
  parsed: {
    name: string | null
    email: string | null
    phone: string | null
    title: string | null
    companyString: string | null
    project: string | null
  }
  signals: string[]
  resolution: CaptureResolution
}
interface SkipSample {
  emailMessageId: string
  inbox: string
  fromAddress: string
  subject: string
  reason: string
}

const autoSamples: AutoSample[] = []
const skipSamples: SkipSample[] = []

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface Candidate {
  id: string
  inbox: string
  fromAddress: string
  subject: string
  extractionRunAt: Date | null
}

async function fetchCandidates(cursorCreatedAt: Date | null, take: number): Promise<Candidate[]> {
  const twelveMonthsAgo = new Date(Date.now() - 365 * 86_400_000)
  const rows = await p.emailMessage.findMany({
    where: {
      direction: 'inbound',
      duplicateOfId: null,
      sentAt: { gte: twelveMonthsAgo },
      emailAccount: { emailAddress: { in: SALES_INBOXES } },
      inquiryCapture: { is: null }, // idempotency — only unprocessed rows
      ...(cursorCreatedAt ? { createdAt: { lt: cursorCreatedAt } } : {}),
    },
    select: {
      id: true,
      fromAddress: true,
      subject: true,
      extractionRunAt: true,
      createdAt: true,
      emailAccount: { select: { emailAddress: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  })
  return rows.map((r) => ({
    id: r.id,
    inbox: r.emailAccount.emailAddress,
    fromAddress: r.fromAddress,
    subject: r.subject,
    extractionRunAt: r.extractionRunAt,
  }))
}

async function processOne(c: Candidate): Promise<void> {
  // Ensure Haiku extraction has run. runMessageExtractionForId is a
  // no-op when extractionRunAt is already set, AND it fires the
  // captureFromEmail follow-up automatically. That means in the
  // common case we don't need to call captureFromEmail ourselves.
  let needsExplicitCapture = false
  if (!c.extractionRunAt) {
    try {
      await runMessageExtractionForId(c.id)
      stats.haikuCalls += 1
      await sleep(HAIKU_THROTTLE_MS)
    } catch (err) {
      console.warn(`  ! extraction failed for ${c.id}:`, err instanceof Error ? err.message : err)
      stats.errors += 1
      return
    }
    // The fire-and-forget capture-from-email follow-up is racy from a
    // script's perspective — we want a deterministic outcome to count
    // and sample. Run it again explicitly; idempotency handles dups.
    needsExplicitCapture = true
  } else {
    needsExplicitCapture = true
  }

  if (!needsExplicitCapture) return

  const outcome = await captureFromEmail(c.id)
  stats.processed += 1
  switch (outcome.status) {
    case 'auto_captured':
      stats.auto += 1
      // Read back the capture to know if it was FILED vs ENRICHED.
      if (outcome.captureId) {
        const row = await p.inquiryCapture.findUnique({
          where: { id: outcome.captureId },
          select: {
            resolution: true,
            signals: true,
            parsedName: true,
            parsedEmail: true,
            parsedPhone: true,
            parsedTitle: true,
            parsedCompanyString: true,
            parsedProject: true,
          },
        })
        if (row) {
          if (row.resolution === CaptureResolution.AUTO_FILED) stats.filedNew += 1
          if (row.resolution === CaptureResolution.AUTO_ENRICHED) stats.enrichedExisting += 1
          if (autoSamples.length < 10) {
            autoSamples.push({
              emailMessageId: c.id,
              inbox: c.inbox,
              fromAddress: c.fromAddress,
              parsed: {
                name: row.parsedName,
                email: row.parsedEmail,
                phone: row.parsedPhone,
                title: row.parsedTitle,
                companyString: row.parsedCompanyString,
                project: row.parsedProject,
              },
              signals: (row.signals as string[] | null) ?? [],
              resolution: row.resolution,
            })
          }
        }
      }
      break
    case 'needs_review':
      stats.review += 1
      break
    case 'skipped':
      stats.skipped += 1
      if (skipSamples.length < 5) {
        skipSamples.push({
          emailMessageId: c.id,
          inbox: c.inbox,
          fromAddress: c.fromAddress,
          subject: c.subject,
          reason: outcome.reason,
        })
      }
      break
    case 'duplicate':
      stats.duplicate += 1
      break
    case 'noop':
      break
  }
}

function fmtPct(n: number, total: number): string {
  if (total === 0) return '--'
  return `${((n / total) * 100).toFixed(1)}%`
}

function printProgress(): void {
  const t = stats.processed
  console.log(
    `  processed=${t}  AUTO=${stats.auto} (${fmtPct(stats.auto, t)})  ` +
      `REVIEW=${stats.review} (${fmtPct(stats.review, t)})  ` +
      `SKIP=${stats.skipped} (${fmtPct(stats.skipped, t)})  ` +
      `dup=${stats.duplicate}  err=${stats.errors}`,
  )
}

function printCalibrationReport(): void {
  console.log('\n' + '═'.repeat(72))
  console.log('CALIBRATION GATE — first 200 messages processed')
  console.log('═'.repeat(72))
  console.log(`Total processed: ${stats.processed}`)
  console.log(`  AUTO_CAPTURED: ${stats.auto} (${fmtPct(stats.auto, stats.processed)})`)
  console.log(`    ↳ AUTO_FILED (new Person):     ${stats.filedNew}`)
  console.log(`    ↳ AUTO_ENRICHED (existing):    ${stats.enrichedExisting}`)
  console.log(`  NEEDS_REVIEW:  ${stats.review} (${fmtPct(stats.review, stats.processed)})`)
  console.log(`  SKIPPED:       ${stats.skipped} (${fmtPct(stats.skipped, stats.processed)})`)
  console.log(`  duplicates:    ${stats.duplicate}`)
  console.log(`  errors:        ${stats.errors}`)
  console.log(`  Haiku calls:   ${stats.haikuCalls}`)

  console.log('\n── 10 sample AUTO captures ─────────────────────────────────────────')
  autoSamples.forEach((s, i) => {
    console.log(`\n  [${i + 1}] ${s.fromAddress}  → ${s.inbox}`)
    console.log(`      name=${s.parsed.name ?? '-'}  email=${s.parsed.email ?? '-'}`)
    console.log(`      phone=${s.parsed.phone ?? '-'}  title=${s.parsed.title ?? '-'}`)
    console.log(`      company="${s.parsed.companyString ?? '-'}"  project="${s.parsed.project ?? '-'}"`)
    console.log(`      signals=[${s.signals.join(', ')}]  → ${s.resolution}`)
  })

  console.log('\n── 5 sample SKIPs ──────────────────────────────────────────────────')
  skipSamples.forEach((s, i) => {
    console.log(`\n  [${i + 1}] ${s.fromAddress}  → ${s.inbox}`)
    console.log(`      subject: "${s.subject.slice(0, 80)}"`)
    console.log(`      reason: ${s.reason}`)
  })

  console.log('\n' + '═'.repeat(72))
  console.log('Eyeball the samples above. If verdicts look right, re-run with')
  console.log('  npx tsx scripts/backfillCrmCapture.ts --continue')
  console.log('to process the remainder unattended.')
  console.log('═'.repeat(72) + '\n')
}

async function printFinalReport(): Promise<void> {
  console.log('\n' + '═'.repeat(72))
  console.log('BACKFILL RUN COMPLETE')
  console.log('═'.repeat(72))
  console.log(`Total processed: ${stats.processed}`)
  console.log(`  AUTO_CAPTURED: ${stats.auto} (${fmtPct(stats.auto, stats.processed)})`)
  console.log(`    ↳ AUTO_FILED (new Person):     ${stats.filedNew}`)
  console.log(`    ↳ AUTO_ENRICHED (existing):    ${stats.enrichedExisting}`)
  console.log(`  NEEDS_REVIEW:  ${stats.review} (${fmtPct(stats.review, stats.processed)})`)
  console.log(`  SKIPPED:       ${stats.skipped} (${fmtPct(stats.skipped, stats.processed)})`)
  console.log(`  duplicates:    ${stats.duplicate}`)
  console.log(`  errors:        ${stats.errors}`)
  console.log(`  Haiku calls:   ${stats.haikuCalls}`)

  // Role distribution from this run — count Persons with sourceMessageId
  // pointing at an EmailMessage we processed. Approximation: any Person
  // whose sourceMessageId is non-null and updated since the run started.
  // Cleaner: count InquiryCaptures with personId set this run, then
  // group their persons by role.
  console.log('\n── Role distribution (this run, AUTO_FILED only) ───────────────────')
  const filed = await p.inquiryCapture.findMany({
    where: { resolution: CaptureResolution.AUTO_FILED, personId: { not: null } },
    select: { person: { select: { role: true } } },
    orderBy: { createdAt: 'desc' },
    take: stats.filedNew,
  })
  const roleCounts: Record<string, number> = {}
  for (const f of filed) {
    if (!f.person) continue
    const r = f.person.role
    roleCounts[r] = (roleCounts[r] ?? 0) + 1
  }
  for (const role of Object.values(PersonRole)) {
    const n = roleCounts[role] ?? 0
    if (n > 0) console.log(`  ${role.padEnd(34)} ${n}`)
  }

  console.log('\n── Top 20 captured companies-by-string with NO CRM match ──────────')
  console.log('   (candidates for manual Company creation in /crm)')
  const unmatched = await p.inquiryCapture.groupBy({
    by: ['parsedCompanyString'],
    where: {
      verdict: CaptureVerdict.AUTO_CAPTURED,
      companyId: null,
      parsedCompanyString: { not: null },
    },
    _count: { _all: true },
    orderBy: { _count: { parsedCompanyString: 'desc' } },
    take: 20,
  })
  unmatched.forEach((u, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${(u.parsedCompanyString ?? '').padEnd(50)} ${u._count._all}`)
  })

  console.log('\n' + '═'.repeat(72) + '\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const skipCalibrationGate = args.includes('--continue')
  const limitArg = args.find((a) => a.startsWith('--limit'))
  const limit = limitArg
    ? Number(limitArg.split('=')[1] ?? args[args.indexOf(limitArg) + 1])
    : null
  const hardCap = skipCalibrationGate
    ? limit ?? Infinity
    : Math.min(CALIBRATION_LIMIT, limit ?? CALIBRATION_LIMIT)

  console.log(
    `Starting CRM capture backfill — ${SALES_INBOXES.join(', ')} · last 12 months · ` +
      (skipCalibrationGate ? 'unattended' : `calibration gate @ ${CALIBRATION_LIMIT}`) +
      (limit ? ` · --limit=${limit}` : ''),
  )

  let cursorCreatedAt: Date | null = null
  let consecutiveEmpty = 0

  while (stats.processed < hardCap) {
    const remaining = Math.max(1, Math.min(BATCH_SIZE, hardCap - stats.processed))
    const candidates = await fetchCandidates(cursorCreatedAt, remaining)
    if (candidates.length === 0) {
      consecutiveEmpty += 1
      if (consecutiveEmpty >= 2) {
        console.log('\nNo more unprocessed candidates in scope. Done.')
        break
      }
      continue
    }
    consecutiveEmpty = 0
    for (const c of candidates) {
      if (stats.processed >= hardCap) break
      await processOne(c)
      if (stats.processed % 25 === 0) printProgress()
    }
    // Advance the cursor to keep pulling older rows.
    const last = candidates[candidates.length - 1]
    const lastRow = await p.emailMessage.findUnique({
      where: { id: last.id },
      select: { createdAt: true },
    })
    cursorCreatedAt = lastRow?.createdAt ?? null
  }

  if (!skipCalibrationGate && stats.processed >= CALIBRATION_LIMIT) {
    printCalibrationReport()
  } else {
    await printFinalReport()
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })
  .finally(() => p.$disconnect())
