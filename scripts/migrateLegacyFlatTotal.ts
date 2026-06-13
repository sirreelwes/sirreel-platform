/**
 * One-shot migration: convert legacy FIXED-stored flat-total order
 * discounts to the new FLAT_TOTAL live-pinned semantics where the
 * target is recoverable from the row's auto-generated label.
 *
 * Recovery: labels of the form "Flat $X[.YY] total" or
 * "Flat $X[,XXX][.YY] dept total" carry the target the user typed.
 * We parse that number, swap the row to FLAT_TOTAL, store the target
 * as `value`, then re-run recalcOrderTotals so the order's persisted
 * subtotal/tax/total snap back to the target.
 *
 * SAFETY:
 *   - Skips orders in INVOICED or CLOSED status — those totals are
 *     paper-trail-committed and must not move as a side effect of
 *     this fix.
 *   - Skips rows where the label can't be parsed — those stay FIXED.
 *   - Dry-run by default; pass --apply to write.
 */
import { prisma } from '../src/lib/prisma'
import { recalcOrderTotals } from '../src/lib/orders'

const APPLY = process.argv.includes('--apply')

// "Flat $2,500.00 total" or "E2E test — Flat $1000 total" or
// "Flat $750 dept total" — capture the dollar amount.
const FLAT_LABEL_RE = /Flat\s*\$([\d,]+(?:\.\d+)?)\s*(?:dept\s+)?total/i

function parseTarget(label: string): number | null {
  const m = label.match(FLAT_LABEL_RE)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

async function main() {
  const rows = await prisma.orderDiscount.findMany({
    where: {
      type: 'FIXED',
      label: { contains: 'Flat', mode: 'insensitive' },
    },
    select: {
      id: true, orderId: true, value: true, label: true, scope: true,
      order: { select: { orderNumber: true, status: true } },
    },
  })

  console.log(`Found ${rows.length} candidate FIXED flat-total discount rows\n`)

  let converted = 0
  let skippedLocked = 0
  let skippedUnparsable = 0
  let skippedDept = 0

  for (const r of rows) {
    // FLAT_TOTAL is ORDER-scope only. Department-scope "Flat ... dept total"
    // rows stay FIXED — the dept-subtotal math is pre-tax and the conversion
    // was exact at save time, so they don't drift the same way.
    if (r.scope !== 'ORDER') {
      console.log(`  skip (DEPT scope)   ${r.order.orderNumber}  "${r.label}"`)
      skippedDept++
      continue
    }
    if (r.order.status === 'INVOICED' || r.order.status === 'CLOSED') {
      console.log(`  skip (locked ${r.order.status})  ${r.order.orderNumber}  "${r.label}"`)
      skippedLocked++
      continue
    }
    const target = parseTarget(r.label)
    if (target == null) {
      console.log(`  skip (no target in label)  ${r.order.orderNumber}  "${r.label}"`)
      skippedUnparsable++
      continue
    }
    console.log(`  convert  ${r.order.orderNumber}  "${r.label}"  $${r.value} → FLAT_TOTAL target=$${target}`)
    if (APPLY) {
      await prisma.orderDiscount.update({
        where: { id: r.id },
        data: { type: 'FLAT_TOTAL', value: target },
      })
      const after = await recalcOrderTotals(r.orderId)
      console.log(`    → recalc: total=$${after.total} subtotal=$${after.subtotal}`)
    }
    converted++
  }

  console.log()
  console.log(`Converted:        ${converted}`)
  console.log(`Skipped (locked): ${skippedLocked}`)
  console.log(`Skipped (DEPT):   ${skippedDept}`)
  console.log(`Skipped (unparse):${skippedUnparsable}`)
  if (!APPLY) console.log('\n(dry-run — pass --apply to write)')
}

main().finally(() => prisma.$disconnect())
