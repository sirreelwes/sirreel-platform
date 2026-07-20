import { prisma } from '../src/lib/prisma'
async function main() {
  const targets = [
    'Cube 5', 'Cube 11', 'Cube 12', 'Cube 15', 'Cube 16', 'Cube 17', 'Cube 18',
    'Cargo 20', 'Cargo 21', 'Cargo 22', 'Cargo 23', 'Cargo 24', 'Cargo 25',
    'Pass 1', 'Pass 2',
  ]
  for (const name of targets) {
    const assets = await prisma.asset.findMany({
      where: { unitName: name },
      select: { id: true, isActive: true, status: true, category: { select: { name: true } }, _count: { select: { bookingAssignments: true } } },
    })
    if (assets.length === 0) { console.log(`${name}: ABSENT from fleet data`); continue }
    for (const a of assets) {
      console.log(`${name}: exists [${a.category.name}] active=${a.isActive} status=${a.status} assignments=${a._count.bookingAssignments}`)
    }
  }
  // Passenger Van category roster for the "12-Passenger Vans 1 and 2" check
  const passAssets = await prisma.asset.findMany({
    where: { category: { name: 'Passenger Van' } },
    select: { unitName: true, isActive: true },
    orderBy: { unitName: 'asc' },
  })
  console.log('\nPassenger Van roster:', passAssets.map(a => `${a.unitName}${a.isActive ? '' : ' (inactive)'}`).join(', '))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
