/**
 * Recompute Company.totalSpend / totalBookings / lastRentalAt from the
 * RentalWorks invoice mirror.
 *
 * See src/lib/crm/spendRollup.ts for the reasoning. The short version:
 * those columns had never been written by anything, so the entire CRM
 * scoring layer — top-client badges, the Top-clients chip, the spend
 * sort, three People segments — was reading zeros and reporting "nobody
 * qualifies".
 *
 * Safe to re-run. It RECOMPUTES rather than accumulating, because the RW
 * mirror is deleted and rebuilt on every sync.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/rollupCompanySpend.ts          # dry run
 *   npx tsx scripts/rollupCompanySpend.ts --write  # apply
 */

import './_loadProdEnv'
import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'node:fs'
import { buildRollupPlan, applyRollup } from '../src/lib/crm/spendRollup'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

async function main() {
  console.log(WRITE ? '=== APPLYING ===' : '=== DRY RUN (pass --write to apply) ===\n')

  const plan = await buildRollupPlan()

  console.log(`RW invoices in the mirror: ${plan.invoiceCount}`)
  console.log(`Companies that will get real numbers: ${plan.rows.length}`)
  console.log(`  revenue attributed: ${money(plan.totalMatchedRevenue)}`)
  console.log(`  revenue with NO company match: ${money(plan.unmatchedRevenue)} (${(
    (plan.unmatchedRevenue / (plan.totalMatchedRevenue + plan.unmatchedRevenue)) * 100
  ).toFixed(1)}%)`)
  console.log(`Companies whose stale total will be reset to 0: ${plan.zeroedCompanies}`)

  console.log('\nTOP CLIENTS AFTER THIS RUN')
  plan.rows.slice(0, 15).forEach((r, i) => {
    const last = r.lastRentalAt ? r.lastRentalAt.toISOString().slice(0, 10) : '—'
    console.log(
      `  ${String(i + 1).padStart(2)}. ${money(r.totalSpend).padStart(11)}  ${String(r.totalBookings).padStart(3)} rentals  last ${last}`,
    )
  })

  console.log('\nBIGGEST UNMATCHED RW CUSTOMERS — no HQ company carries this id.')
  console.log('Link them on the company record to bring this revenue in:\n')
  plan.unmatchedCustomers.slice(0, 12).forEach((u) =>
    console.log(`  ${money(u.total).padStart(11)}  ${u.customerName ?? '(no name)'}  [rw ${u.rwCustomerId}]`),
  )

  if (!WRITE) {
    console.log('\nDry run complete. Re-run with --write to apply.')
    return
  }

  // Reversal record — prior values for every company this run touches.
  const touched = await prisma.company.findMany({
    where: { OR: [{ rentalworksCustomerId: { not: null } }, { totalSpend: { gt: 0 } }] },
    select: { id: true, name: true, totalSpend: true, totalBookings: true, lastRentalAt: true },
  })
  mkdirSync('journals', { recursive: true })
  const path = `journals/spend-rollup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(
    path,
    JSON.stringify(
      { priorValues: touched.map((c) => ({ ...c, totalSpend: c.totalSpend.toString() })) },
      null,
      2,
    ),
  )

  const result = await applyRollup(plan)
  console.log(`\nUpdated ${result.updated} companies; reset ${result.zeroed} stale totals.`)
  console.log(`Rolled up at ${result.rolledUpAt.toISOString()}`)
  console.log(`Prior values written to ${path} — restore BY THESE IDS if this needs undoing.`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
