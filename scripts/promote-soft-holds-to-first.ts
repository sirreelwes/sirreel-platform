/**
 * One-off: existing SOFT holds become 1st Holds.
 *
 * Wes 2026-09-09 — "quoted vehicles should consume capacity too; they
 * should rank like normal holds until capacity becomes an issue and the
 * agent decides rank." Going forward `holdOnQuoteSend` mints at rank 1.
 * This lifts the rows already in the ground.
 *
 * ONLY promotes a hold that has ROOM at rank 1 in its own window
 * (availability computed excluding its own demand). A hold with no room
 * is genuinely queued behind another production and MUST stay a backup —
 * promoting it would put two 1st Holds on the same units, which is the
 * over-commit the whole queue exists to prevent.
 *
 * Never touches a rank a human set (`rankLockedAt`).
 *
 * Journals every change by captured id so it is reversible.
 *
 *   npx tsx scripts/promote-soft-holds-to-first.ts          # dry run
 *   npx tsx scripts/promote-soft-holds-to-first.ts --write
 */
import { writeFileSync, mkdirSync } from 'fs'
import { prisma } from '../src/lib/prisma'
import { getCategoryAvailability } from '../src/lib/scheduling/availability'

async function main() {
  const write = process.argv.includes('--write')
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const soft = await prisma.bookingItem.findMany({
    where: {
      holdRank: { gte: 2 },
      status: { in: ['REQUESTED', 'ASSIGNED'] },
      rankLockedAt: null, // a human's queue decision is not ours to undo
      booking: { archivedAt: null, endDate: { gte: today } },
    },
    select: {
      id: true, quantity: true, categoryId: true, holdRank: true,
      category: { select: { name: true } },
      booking: { select: { bookingNumber: true, jobName: true, startDate: true, endDate: true } },
    },
  })

  const promote: typeof soft = []
  const keep: { item: (typeof soft)[number]; avail: number }[] = []
  for (const s of soft) {
    const a = await getCategoryAvailability(s.categoryId, s.booking.startDate, s.booking.endDate, 1, s.id)
    if (a.availableToHold >= s.quantity) promote.push(s)
    else keep.push({ item: s, avail: a.availableToHold })
  }

  console.log(`soft holds considered : ${soft.length}`)
  console.log(`  -> promote to rank 1: ${promote.length}`)
  console.log(`  -> genuinely queued, left alone: ${keep.length}`)
  for (const k of keep) {
    console.log(`     KEEP ${k.item.category.name} x${k.item.quantity} rank${k.item.holdRank} ` +
      `${k.item.booking.startDate.toISOString().slice(0, 10)}..${k.item.booking.endDate.toISOString().slice(0, 10)} ` +
      `${k.item.booking.jobName || k.item.booking.bookingNumber} (availableToHold ${k.avail})`)
  }

  if (!write) {
    console.log('\nDRY RUN — nothing written. Re-run with --write.')
    await prisma.$disconnect()
    return
  }

  const journal = promote.map((p) => ({
    bookingItemId: p.id,
    fromRank: p.holdRank,
    toRank: 1,
    category: p.category.name,
    quantity: p.quantity,
    booking: p.booking.bookingNumber,
    jobName: p.booking.jobName,
    window: `${p.booking.startDate.toISOString().slice(0, 10)}..${p.booking.endDate.toISOString().slice(0, 10)}`,
  }))

  for (const p of promote) {
    await prisma.bookingItem.update({ where: { id: p.id }, data: { holdRank: 1 } })
  }

  mkdirSync('journals', { recursive: true })
  const path = `journals/promote-soft-holds-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(path, JSON.stringify({ ranAt: new Date().toISOString(), promoted: journal, keptAsBackup: keep.map((k) => k.item.id) }, null, 2))
  console.log(`\npromoted ${promote.length}. journal: ${path}`)
  console.log('reverse with: set holdRank back to fromRank for each bookingItemId in the journal')
  await prisma.$disconnect()
}
main()
