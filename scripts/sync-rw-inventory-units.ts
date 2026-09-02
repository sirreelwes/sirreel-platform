/**
 * Manual run of the RentalWorks per-unit barcode mirror.
 *
 *   npx vercel env run -e production -- npx tsx scripts/sync-rw-inventory-units.ts
 *
 * The `vercel env run` wrapper is not optional: the RW credential is
 * encrypted with RW_TOKEN_KEY, which is deliberately not in .env.local.
 * Without it the client raises RwNoCredentialError rather than silently
 * reading nothing.
 *
 * Same code path as the nightly cron (/api/cron/rw-inventory-units) —
 * this exists for the first population and for a refresh right after RW
 * receives new gear. Read-only against RentalWorks; upsert-only on our
 * side, so re-running is safe and idempotent.
 */
import { syncInventoryUnits } from '../src/lib/rentalworks/syncInventoryUnits'
import { prisma } from '../src/lib/prisma'

async function main() {
  const started = Date.now()
  const r = await syncInventoryUnits()

  if (!r.ok) {
    console.error(`\n✗ sync failed: ${r.error}\n`)
    process.exitCode = 1
    return
  }

  console.log(`\nRentalWorks unit register → HQ  (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  console.log(`  pulled from RW  : ${r.pulled} across ${r.pages} page(s)`)
  console.log(`  written         : ${r.written}  (${r.created} new)`)
  console.log(`  unmatched units : ${r.unmatched}`)
  console.log(`  stale in HQ     : ${r.stale}  (kept — RW retires, it does not delete)`)

  if (r.unmatchedICodes.length) {
    console.log(`\n  RW item codes with no HQ catalog row (${r.unmatchedICodes.length}):`)
    console.log(`    ${r.unmatchedICodes.join(', ')}`)
    console.log('  Units on these codes will not resolve on a scan until someone')
    console.log('  sets InventoryItem.rwICode on the matching catalog row.')
  }

  const byStatus = await prisma.inventoryUnit.groupBy({
    by: ['status'],
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
  })
  console.log('\n  by RW status:')
  for (const s of byStatus) {
    console.log(`    ${String(s.status ?? '—').padEnd(12)} ${s._count._all}`)
  }
  console.log('')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
