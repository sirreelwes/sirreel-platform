import { prisma } from '../src/lib/prisma'
async function main() {
  // Exactly the fixed route's roster query
  const roster = await prisma.asset.findMany({
    where: { isActive: true, category: { reservableOnGantt: true } },
    select: { id: true, unitName: true, category: { select: { name: true } } },
  })
  const byCat = new Map<string, number>()
  for (const r of roster) byCat.set(r.category.name, (byCat.get(r.category.name) ?? 0) + 1)
  const fleet = await prisma.assetCategory.findMany({
    where: { reservableOnGantt: true },
    select: { name: true, _count: { select: { assets: { where: { isActive: true } } } } },
    orderBy: { name: 'asc' },
  })
  console.log('category | gantt rows | active fleet assets | match')
  for (const c of fleet) {
    const rows = byCat.get(c.name) ?? 0
    console.log(`${c.name} | ${rows} | ${c._count.assets} | ${rows === c._count.assets ? '✓' : '✗ MISMATCH'}`)
  }
  console.log('total rows:', roster.length)
  // Oliver's units present?
  const names = new Set(roster.map(r => r.unitName))
  const check = ['Cube 5','Cube 11','Cube 12','Cube 15','Cube 16','Cube 17','Cube 18','Cargo 20','Cargo 21','Cargo 22','Cargo 23','Cargo 24','Cargo 25','Pass 1','Pass 2']
  console.log('\nOliver units all in roster:', check.every(n => names.has(n)) ? 'YES' : 'NO: ' + check.filter(n => !names.has(n)).join(','))
  // Still-unbound live booking lines
  const unbound = await prisma.bookingItem.findMany({
    where: {
      booking: { archivedAt: null, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
    },
    select: { quantity: true, _count: { select: { assignments: true } }, category: { select: { name: true } }, booking: { select: { bookingNumber: true } }, holdRank: true },
  })
  const short = unbound.filter(i => i._count.assignments < i.quantity)
  console.log(`\nstill-unbound lines (${short.length}):`)
  for (const i of short) console.log(`  ${i.booking.bookingNumber} ${i.category.name} ${i._count.assignments}/${i.quantity}${i.holdRank > 1 ? ' (backup)' : ''}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
