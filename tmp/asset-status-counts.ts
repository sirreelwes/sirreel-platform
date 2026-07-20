import { prisma } from '../src/lib/prisma'
async function main() {
  const byStatus = await prisma.asset.groupBy({ by: ['status', 'isActive'], _count: true })
  console.log(byStatus)
  const inactive = await prisma.asset.findMany({
    where: { isActive: false, category: { reservableOnGantt: true } },
    select: { unitName: true, status: true, category: { select: { name: true } } },
  })
  console.log('\ninactive assets in gantt categories:')
  for (const a of inactive) console.log(`  [${a.category.name}] ${a.unitName} status=${a.status}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
