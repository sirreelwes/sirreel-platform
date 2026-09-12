/**
 * One-time backfill — restate OrderLineItem.computedDays as the
 * calendar days the line TOUCHES, both ends included.
 *
 * WHY. computedDays is the denominator under "Days" on the order page,
 * the quote PDF and the invoice ("3/2" = billing 3 of a 2-day span).
 * Until 2026-09-12 it stored the exclusive gap (Sep 14 → 16 = 2) while
 * the billed count written on create was inclusive (3), so a cargo van
 * read 3/2 — an apparent overcharge (Wes, forwarded 2026-09-12). The
 * derivation (src/lib/orders/days.ts computeDays) is now inclusive;
 * this restates the rows written under the old formula.
 *
 * MONEY. Measured before writing: no line prices on computedDays —
 * every row with computed_days also has days (billableDays) set, and
 * pricing is billableDays ?? computedDays. lineTotal is untouched and
 * recalcOrderTotals is NOT called. This changes a displayed
 * denominator, nothing else.
 *
 * SAFETY. Rows are selected by the formula mismatch, ids captured, and
 * every write is by captured id with the before-value journaled to
 * journals/backfill-computed-days-inclusive-<stamp>.json. Nothing is
 * deleted. Idempotent: a second run finds nothing to do.
 *
 * Run (dry by default):
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/backfill-computed-days-inclusive.ts
 *   npx tsx scripts/backfill-computed-days-inclusive.ts --write
 */
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'fs'
import { computeDays } from '../src/lib/orders/days'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')

async function main() {
  const rows = await prisma.orderLineItem.findMany({
    select: { id: true, pickupDate: true, returnDate: true, computedDays: true, billableDays: true, description: true, orderId: true },
  })
  const changes = rows
    .map((r) => ({ ...r, next: computeDays(r.pickupDate, r.returnDate) }))
    .filter((r) => r.computedDays !== r.next)
  const pricedOnComputed = changes.filter((r) => r.billableDays == null)

  console.log(`${rows.length} dated lines, ${changes.length} to restate, ${pricedOnComputed.length} would move price (billableDays null)`)
  if (pricedOnComputed.length) {
    console.log('REFUSING: these lines price on computedDays — resolve billableDays first:')
    for (const r of pricedOnComputed) console.log(`  ${r.id} ${r.description}`)
    process.exitCode = 1
    return
  }
  for (const r of changes.slice(0, 15)) {
    console.log(`  ${r.id}  ${r.pickupDate.toISOString().slice(0, 10)} → ${r.returnDate.toISOString().slice(0, 10)}  ${r.computedDays ?? 'null'} → ${r.next}  (billed ${r.billableDays})  ${r.description}`)
  }
  if (changes.length > 15) console.log(`  … ${changes.length - 15} more`)
  if (!WRITE) { console.log('\nDry run. Re-run with --write to apply.'); return }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const journal = `journals/backfill-computed-days-inclusive-${stamp}.json`
  writeFileSync(journal, JSON.stringify({
    ranAt: new Date().toISOString(),
    why: 'computedDays restated as inclusive calendar days (Sep 14 → 16 = 3). Display denominator only; no line priced on it.',
    revert: 'UPDATE sr_order_line_items SET computed_days = <before> WHERE id = <id>',
    rows: changes.map((r) => ({ id: r.id, orderId: r.orderId, before: r.computedDays, after: r.next })),
  }, null, 2))
  console.log(`journal → ${journal}`)

  let done = 0
  for (const batch of chunk(changes, 50)) {
    await prisma.$transaction(batch.map((r) =>
      prisma.orderLineItem.update({ where: { id: r.id }, data: { computedDays: r.next } })
    ))
    done += batch.length
  }
  console.log(`restated ${done} lines`)
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
