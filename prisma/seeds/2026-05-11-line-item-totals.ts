/**
 * Backfill OrderLineItem.lineTotal + Order subtotal/tax/total.
 *
 * Why: line items written by older code paths (pre-billing.ts integration
 * into the POST/PUT routes) have stale or zeroed lineTotal columns. The
 * sales pipeline's persisted Order.subtotal cascades from those, so quote
 * builders, summaries, and the PDF have all been pulling $0 for affected
 * rows.
 *
 * What this does: recalcOrderTotals (in src/lib/orders.ts) is now
 * self-healing — it recomputes each line's total from canonical source
 * fields before summing the order. This seed just walks every Order
 * and calls it, which fixes every stale lineTotal in one pass.
 *
 * Idempotent: a clean re-run on already-correct data writes nothing
 * (the in-loop dirty check skips no-op updates).
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx prisma/seeds/2026-05-11-line-item-totals.ts
 */

import { prisma } from '../../src/lib/prisma'
import { recalcOrderTotals } from '../../src/lib/orders'

async function main() {
  const orders = await prisma.order.findMany({
    select: { id: true, orderNumber: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Walking ${orders.length} Order rows`)

  let touched = 0
  let unchanged = 0
  let errored = 0

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i]
    try {
      const before = await prisma.order.findUnique({
        where: { id: o.id },
        select: { subtotal: true, total: true },
      })
      const after = await recalcOrderTotals(o.id)
      const beforeTotal = before ? Number(before.total) : 0
      const drift = Math.abs(beforeTotal - after.total)
      if (drift > 0.005) {
        touched++
        console.log(`[${i + 1}/${orders.length}] ${o.orderNumber}  $${beforeTotal.toFixed(2)} → $${after.total.toFixed(2)}`)
      } else {
        unchanged++
      }
    } catch (err) {
      errored++
      console.log(`[${i + 1}/${orders.length}] ${o.orderNumber}  ✗ ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log()
  console.log('───── SUMMARY ─────')
  console.log(`Orders walked:   ${orders.length}`)
  console.log(`Totals corrected: ${touched}`)
  console.log(`Already correct:  ${unchanged}`)
  console.log(`Errored:          ${errored}`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
