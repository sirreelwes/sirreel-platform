/**
 * Catch up the orders that were already booked in every way but status.
 *
 * Wes, 2026-09-19: "I hate seeing jobs that have wrapped that show that
 * they were never booked. That doesn't make any sense." The forward rule
 * now books an order the moment its rental agreement and COI are both in
 * (src/lib/orders/autoBook.ts) — this is the one-time pass over the rows
 * that completed their paperwork before that rule existed. Measured
 * 2026-09-19: 20 pre-BOOKED orders held both documents, 10 of them with
 * pickup days already behind them.
 *
 * ── Same rule, no shortcuts ────────────────────────────────────────────
 * It calls maybeAutoBookOrder(), so this script cannot book anything the
 * live rule would not: DRAFT is excluded, an unanswered quote papered
 * only by a sibling is excluded, and the shoot-days / partner-floor /
 * unsigned-partner gates all still apply. What it does NOT do is judge
 * by date — a papered order is a booked order whether its pickup is next
 * month or was in July.
 *
 * ── It sends nothing ───────────────────────────────────────────────────
 * Every book here runs SILENT (no BOOKING_WELCOME, no partner "it's a
 * go"). The forward rule silences historical rows on its own; this
 * script silences ALL of them, including the future-dated ones, because
 * a backfill is a bookkeeping correction and nobody should learn about
 * it by email. Pass --allow-email to let future-dated rows take the
 * normal live path (the past-dated ones stay silent regardless) — only
 * with Wes's say-so, and the dry run lists exactly who would be written
 * to first.
 *
 * Reversible: every id is captured to journals/ before the write, and
 * each order carries an AuditLog `order.auto_booked` (plus bookOrder's
 * own `order.booked`, which holds the pre-book status and totals).
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/backfill-auto-book.ts            # dry run
 *   npx tsx scripts/backfill-auto-book.ts --apply    # book them
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'fs'
import { maybeAutoBookOrder, AUTO_BOOKABLE_FROM } from '../src/lib/orders/autoBook'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const ALLOW_EMAIL = process.argv.includes('--allow-email')

const OPERATOR_EMAIL = 'wes@sirreel.com'

function day(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '—'
}

async function main() {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to book) ===')
  console.log(ALLOW_EMAIL ? 'Future-dated rows WILL send the usual booking mail.\n' : 'Silent: no client or partner mail for any row.\n')

  const operator = await prisma.user.findFirst({
    where: { email: OPERATOR_EMAIL },
    select: { id: true },
  })
  if (!operator) throw new Error(`No User row for ${OPERATOR_EMAIL} — refusing to write unattributed rows`)

  const candidates = await prisma.order.findMany({
    where: { archivedAt: null, status: { in: [...AUTO_BOOKABLE_FROM] } },
    select: { id: true, orderNumber: true, status: true, startDate: true, endDate: true, total: true, job: { select: { jobCode: true, name: true } } },
    orderBy: { startDate: 'asc' },
  })
  console.log(`Pre-BOOKED orders in scope: ${candidates.length}\n`)

  // Dry-run first ALWAYS — the list is the approval artifact.
  const eligible: typeof candidates = []
  const skipped: { orderNumber: string; reason: string }[] = []
  for (const o of candidates) {
    const r = await maybeAutoBookOrder(o.id, { trigger: 'backfill', dryRun: true })
    if (r.booked) eligible.push(o)
    else skipped.push({ orderNumber: o.orderNumber, reason: `${r.reason}${r.detail ? ` (${r.detail})` : ''}` })
  }

  console.log('WOULD BOOK:')
  for (const o of eligible) {
    const past = o.startDate && o.startDate.getTime() < Date.now()
    console.log(
      `  ${o.orderNumber}  ${o.status.padEnd(10)} ${day(o.startDate)}→${day(o.endDate)}  ${past ? 'past  ' : 'live  '} ${o.job?.jobCode ?? '—'}  ${o.job?.name ?? ''}`,
    )
  }
  console.log(`\n  ${eligible.length} order(s); ${skipped.length} left alone.`)

  if (!APPLY) {
    const byReason = new Map<string, number>()
    for (const s of skipped) {
      const key = s.reason.split(' (')[0]!
      byReason.set(key, (byReason.get(key) ?? 0) + 1)
    }
    console.log('\nLEFT ALONE, by reason:')
    for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${reason}`)
    console.log('\nDry run — nothing written. Re-run with --apply.')
    return
  }

  mkdirSync('journals', { recursive: true })
  const path = `journals/backfill-auto-book-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(
    path,
    JSON.stringify(
      {
        rule: 'signed rental agreement + approved COI',
        allowEmail: ALLOW_EMAIL,
        orderIds: eligible.map((o) => o.id),
        orders: eligible.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          previousStatus: o.status,
          startDate: o.startDate,
          endDate: o.endDate,
          total: o.total.toString(),
          jobCode: o.job?.jobCode ?? null,
        })),
      },
      null,
      2,
    ),
  )
  console.log(`\nJournal: ${path}`)

  let booked = 0
  const failures: { orderNumber: string; reason: string }[] = []
  for (const o of eligible) {
    const r = await maybeAutoBookOrder(o.id, {
      trigger: 'backfill',
      userId: operator.id,
      forceSilent: !ALLOW_EMAIL,
    })
    if (r.booked) {
      booked++
      console.log(`  booked ${r.orderNumber}${r.silent ? ' (silent)' : ' (mail sent)'}`)
    } else {
      failures.push({ orderNumber: o.orderNumber, reason: `${r.reason}${r.detail ? ` (${r.detail})` : ''}` })
      console.error(`  FAILED ${o.orderNumber}: ${r.reason} ${r.detail ?? ''}`)
    }
  }

  console.log(`\nBooked ${booked} of ${eligible.length}.`)
  if (failures.length) {
    console.error(`${failures.length} failed — they are unchanged and can be re-run.`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
