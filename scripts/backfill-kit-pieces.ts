/**
 * Fill in the included accessories on orders that were written BEFORE
 * the kit was configured.
 *
 *   npx tsx scripts/backfill-kit-pieces.ts              # dry run
 *   npx tsx scripts/backfill-kit-pieces.ts --write
 *   npx tsx scripts/backfill-kit-pieces.ts --days 30 --write
 *   npx tsx scripts/backfill-kit-pieces.ts --order S260913-002 --write
 *
 * Why this has to exist at all: `deriveKitPieceLines` counts only order
 * lines written at or after the kit row itself, so attaching antennas to
 * the radios today leaves every radio already on a quote untouched. That
 * guard is Wes's, 2026-09-07 — "rate changes should never change past
 * invoices" — and it is right. But it means the orders going out THIS
 * week, the ones that prompted the whole exercise, would still be pulled
 * without antennas.
 *
 * So the backfill is the deliberate, journaled, human-run half of that
 * rule rather than an exception to it:
 *
 *   - it refuses CHARGED pieces outright (kitPieces.ts `freeBackfill`),
 *     so no order can gain a charge it was not quoted;
 *   - it does not touch order totals — every line it adds is $0;
 *   - it only looks FORWARD by default. Gear that has already gone out
 *     and come back does not need a line added after the fact, and an
 *     invoiced order is settled money;
 *   - every line it creates is journalled by id, which is the only safe
 *     basis for an undo.
 *
 * It runs the real reconciler (`syncOrderKitPieces`), not a copy of it,
 * so nesting, pick-list membership and the `autoKitPieceId` provenance
 * are whatever the app itself would have written.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
import { PrismaClient } from '@prisma/client'
import { syncOrderKitPieces } from '../src/lib/orders/kitSync'

const prisma = new PrismaClient()
const args = process.argv.slice(2)
const WRITE = args.includes('--write')

function argValue(flag: string): string | null {
  const i = args.indexOf(flag)
  return i === -1 ? null : (args[i + 1] ?? null)
}

/** How far forward to reach. Orders that have not started yet can still
 *  be pulled correctly; ones already out cannot. */
const DAYS = Number(argValue('--days') ?? 21)
const ONLY_ORDER = argValue('--order')

/** Alive and still going out. RETURNED / INVOICED / CLOSED are history. */
const LIVE = ['DRAFT', 'QUOTE_SENT', 'APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB'] as const

const journal = {
  ranAt: new Date().toISOString(),
  write: WRITE,
  days: DAYS,
  onlyOrder: ONLY_ORDER,
  /** Created line ids — the ONLY safe basis for an undo. */
  createdLineIds: [] as Array<{
    orderId: string
    orderNumber: string
    lineItemId: string
    description: string
    quantity: number
  }>,
  resized: [] as Array<{ orderId: string; lineItemId: string; from: number; to: number }>,
}

async function main() {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const until = new Date(today.getTime() + DAYS * 86_400_000)

  const orders = await prisma.order.findMany({
    where: ONLY_ORDER
      ? { orderNumber: ONLY_ORDER }
      : {
          status: { in: [...LIVE] },
          startDate: { gte: today, lte: until },
          quoteStatus: { not: 'LOST' },
          job: { status: { not: 'LOST' }, archivedAt: null },
        },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      startDate: true,
      job: { select: { name: true } },
    },
    orderBy: { startDate: 'asc' },
  })

  console.log(
    `${WRITE ? 'WRITE' : 'DRY RUN'} — included accessories on ${orders.length} order(s)` +
      (ONLY_ORDER ? ` (${ONLY_ORDER})` : ` starting in the next ${DAYS} days`) +
      '\n',
  )

  let touched = 0
  for (const order of orders) {
    // The reconciler is the only thing that knows what a kit line looks
    // like. In dry run it still runs — inside a transaction that is
    // rolled back — so what is printed is exactly what a write would do.
    let result
    try {
      result = await prisma.$transaction(async (tx) => {
        const r = await syncOrderKitPieces(tx, order.id, { freeBackfill: true })
        if (!WRITE) throw new DryRun(r)
        return r
      })
    } catch (e) {
      if (e instanceof DryRun) result = e.result
      else throw e
    }

    if (result.noop || (result.created.length === 0 && result.resized.length === 0)) continue
    touched++

    const day = order.startDate ? order.startDate.toISOString().slice(0, 10) : 'no date'
    console.log(`  ${order.orderNumber}  ${day}  ${order.job?.name ?? 'Unnamed job'} (${order.status})`)
    for (const c of result.created) {
      console.log(`    + ${c.quantity} × ${c.description}`)
      journal.createdLineIds.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        lineItemId: c.lineItemId,
        description: c.description,
        quantity: c.quantity,
      })
    }
    for (const r of result.resized) {
      console.log(`    ~ ${r.description}  ${r.from} → ${r.to}`)
      journal.resized.push({ orderId: order.id, lineItemId: r.lineItemId, from: r.from, to: r.to })
    }
    if (result.keptPicked.length > 0) {
      for (const k of result.keptPicked) {
        console.log(`    · kept (already picked) ${k.quantity} × ${k.description}`)
      }
    }

    if (WRITE) {
      await prisma.auditLog.create({
        data: {
          action: 'order.kit_pieces_backfilled',
          entityType: 'order',
          entityId: order.id,
          newValues: {
            created: result.created,
            resized: result.resized,
            triggeredBy: 'scripts/backfill-kit-pieces.ts',
          },
        },
      })
    }
  }

  console.log(
    `\n${touched} order(s) ${WRITE ? 'updated' : 'would change'} — ` +
      `${journal.createdLineIds.length} line(s) added, ${journal.resized.length} resized.`,
  )

  if (WRITE && (journal.createdLineIds.length > 0 || journal.resized.length > 0)) {
    mkdirSync(path.join(process.cwd(), 'journals'), { recursive: true })
    const file = path.join(
      process.cwd(),
      'journals',
      `kit-backfill-${journal.ranAt.replace(/[:.]/g, '-')}.json`,
    )
    writeFileSync(file, JSON.stringify(journal, null, 2))
    console.log(`journal: ${file}`)
    console.log('Undo by captured lineItemId ONLY — never by shape or description.')
  }
  if (!WRITE) console.log('Nothing written. Re-run with --write.')
}

/** Rolls the dry run back while carrying what it would have done out. */
class DryRun extends Error {
  constructor(public result: Awaited<ReturnType<typeof syncOrderKitPieces>>) {
    super('dry run')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
