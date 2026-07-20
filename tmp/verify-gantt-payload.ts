import { prisma } from '../src/lib/prisma'

// Mirrors /api/timeline-native's units[] construction: one row per
// active Asset having >= 1 BookingAssignment, bars = its assignments.
async function main() {
  const assignments = await prisma.bookingAssignment.findMany({
    where: { asset: { isActive: true } },
    select: {
      startDate: true, endDate: true, status: true,
      asset: { select: { id: true, unitName: true, category: { select: { name: true } } } },
      bookingItem: { select: { booking: { select: { bookingNumber: true, jobName: true, status: true, archivedAt: true } } } },
    },
  })
  const live = assignments.filter(a => !a.bookingItem.booking.archivedAt && !['CANCELLED', 'ARCHIVED'].includes(a.bookingItem.booking.status))
  const unitMap = new Map<string, { unit: string; cat: string; bars: string[] }>()
  for (const a of live) {
    const u = unitMap.get(a.asset.id) ?? { unit: a.asset.unitName, cat: a.asset.category.name, bars: [] }
    u.bars.push(`${a.bookingItem.booking.bookingNumber} ${a.startDate.toISOString().slice(0,10)}→${a.endDate.toISOString().slice(0,10)}`)
    unitMap.set(a.asset.id, u)
  }
  console.log(`unit rows with bars: ${unitMap.size} | total bars: ${live.length}`)
  for (const [, u] of [...unitMap].slice(0, 8)) console.log(`  ${u.unit} [${u.cat}]: ${u.bars.join(' · ')}`)
  console.log('  …')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
