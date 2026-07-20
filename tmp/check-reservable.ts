import { prisma } from '../src/lib/prisma'
async function main() {
  const cats = await prisma.assetCategory.findMany({
    select: { name: true, reservableOnGantt: true, isActive: true, _count: { select: { assets: { where: { isActive: true } } } } },
    orderBy: { name: 'asc' },
  })
  for (const c of cats) console.log(`${c.reservableOnGantt ? 'GANTT' : '  no '} active=${c.isActive} assets=${c._count.assets} ${c.name}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
