/**
 * Bulk-import inventory pricing from RentalWorks.
 *
 * Many InventoryItem rows have dailyRate / weeklyRate stored as 0
 * (the schema default — there is no nullable distinction between
 * "never priced" and "deliberately free"). The canonical pricing
 * lives in RentalWorks; this seed pulls it via the existing client
 * (src/lib/rentalworks/client.ts), groups RW Items to one master
 * per InventoryId, and writes the rates back where the platform
 * value is currently 0 (rates) or null (replacementCost).
 *
 * KNOWN TRADE-OFF — distinguishing "never set" from "deliberately
 * zero": the rate columns are Decimal @default(0) (not nullable),
 * so a row that was set to $0 on purpose (e.g. a freebie / loaner)
 * looks identical to a row that was never priced. This script treats
 * any rate of 0 as "unset" and will overwrite it with the RW value.
 * If a row was deliberately $0, the import will silently price it.
 * Mitigation: re-run after the import is finished, scan for any
 * rows that became unexpectedly priced, and zero them again. The
 * RW dailyRate is the source of truth for everything except those
 * edge cases.
 *
 * replacementCost is properly nullable, so its null-vs-zero
 * distinction holds.
 *
 * Idempotent: re-running on already-priced rows is a no-op (the
 * `where: { rate: 0 }` filter skips them). Safe to re-run after a
 * token refresh, partial run, etc.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx dotenv -e .env.local -- npx tsx prisma/seeds/2026-05-11-rentalworks-pricing-backfill.ts
 *
 * Requires RENTALWORKS_TOKEN to be set (and unexpired — per
 * CLAUDE.md the JWT is manually refreshed from browser
 * localStorage). A 401 from RW means the token is stale.
 */

import { prisma } from '../../src/lib/prisma'
import { fetchAllItems, groupItemsToMasters, type RwMaster } from '../../src/lib/rentalworks/client'

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

interface UpdateDecision {
  daily: number | null      // null = no change
  weekly: number | null
  replacement: number | null
}

function decide(
  current: { dailyRate: number; weeklyRate: number; replacementCost: number | null },
  rw: RwMaster,
): UpdateDecision {
  return {
    daily: current.dailyRate === 0 && rw.dailyRate > 0 ? rw.dailyRate : null,
    weekly: current.weeklyRate === 0 && rw.weeklyRate > 0 ? rw.weeklyRate : null,
    replacement: current.replacementCost == null && rw.replacementCost > 0 ? rw.replacementCost : null,
  }
}

async function main() {
  if (!process.env.RENTALWORKS_TOKEN) {
    console.error('RENTALWORKS_TOKEN env var not set. Refresh from browser localStorage and re-run.')
    process.exit(2)
  }

  console.log('Fetching RentalWorks items (paginated 200/page)…')
  let lastPage = 0
  const rwItems = await fetchAllItems({
    pageSize: 200,
    onPage: (page, totalPages, fetched, total) => {
      if (page !== lastPage) {
        console.log(`  page ${page}/${totalPages}  fetched ${fetched}/${total}`)
        lastPage = page
      }
    },
  })
  console.log(`Pulled ${rwItems.length} RW Items total`)

  const masters = groupItemsToMasters(rwItems)
  console.log(`Grouped into ${masters.length} unique InventoryId masters`)

  const byCode = new Map<string, RwMaster>()
  for (const m of masters) {
    if (m.iCode) byCode.set(m.iCode.toUpperCase(), m)
  }
  console.log(`Indexed ${byCode.size} masters by I-Code`)

  const platformItems = await prisma.inventoryItem.findMany({
    select: {
      id: true,
      code: true,
      description: true,
      dailyRate: true,
      weeklyRate: true,
      replacementCost: true,
    },
    orderBy: { code: 'asc' },
  })
  console.log(`Walking ${platformItems.length} platform InventoryItem rows`)
  console.log()

  let updated = 0
  let skipped = 0
  let noMatch = 0
  let errored = 0

  for (let i = 0; i < platformItems.length; i++) {
    const p = platformItems[i]
    const rw = byCode.get(p.code.toUpperCase())
    if (!rw) {
      noMatch++
      // No-match is noisy — only log every 50th to keep output readable.
      if (noMatch % 50 === 0) console.log(`  [${i + 1}/${platformItems.length}] ? ${noMatch} no-RW-match so far`)
      continue
    }

    const current = {
      dailyRate: Number(p.dailyRate),
      weeklyRate: Number(p.weeklyRate),
      replacementCost: p.replacementCost == null ? null : Number(p.replacementCost),
    }
    const d = decide(current, rw)
    const changes: Record<string, number> = {}
    if (d.daily != null) changes.dailyRate = d.daily
    if (d.weekly != null) changes.weeklyRate = d.weekly
    if (d.replacement != null) changes.replacementCost = d.replacement

    if (Object.keys(changes).length === 0) {
      skipped++
      continue
    }

    try {
      await prisma.inventoryItem.update({
        where: { id: p.id },
        data: {
          ...changes,
          rwId: rw.rwInventoryId,
          rwLastSyncedAt: new Date(),
        },
      })
      updated++
      const parts: string[] = []
      if (d.daily != null) parts.push(`daily ${fmtMoney(d.daily)}`)
      if (d.weekly != null) parts.push(`weekly ${fmtMoney(d.weekly)}`)
      if (d.replacement != null) parts.push(`replace ${fmtMoney(d.replacement)}`)
      console.log(`  [${i + 1}/${platformItems.length}] ✓ ${p.code.padEnd(12)} ${p.description?.slice(0, 40) ?? ''}  →  ${parts.join(', ')}`)
    } catch (err) {
      errored++
      console.log(`  [${i + 1}/${platformItems.length}] ✗ ${p.code}  ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log()
  console.log('───── SUMMARY ─────')
  console.log(`Platform items walked: ${platformItems.length}`)
  console.log(`Updated:               ${updated}`)
  console.log(`Already priced:        ${skipped}`)
  console.log(`No RW match:           ${noMatch}`)
  console.log(`Errored:               ${errored}`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
