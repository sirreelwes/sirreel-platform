import { prisma } from '../src/lib/prisma'
async function main() {
  const cats = await prisma.assetCategory.findMany({
    where: { isActive: true },
    select: { name: true, planyoResourceId: true, _count: { select: { assets: true } } },
    orderBy: { name: 'asc' },
  })
  console.log('=== AssetCategories (active) ===')
  for (const c of cats) console.log(`  planyoId=${String(c.planyoResourceId).padEnd(8)} assets=${String(c._count.assets).padEnd(3)} ${c.name}`)
  const cargo = await prisma.asset.findMany({
    where: { isActive: true, category: { name: { contains: 'Cargo', mode: 'insensitive' } } },
    select: { unitName: true, category: { select: { name: true } } },
    orderBy: { unitName: 'asc' },
  })
  console.log('\n=== Cargo assets ===')
  for (const a of cargo) console.log(`  [${a.category.name}] ${a.unitName}`)
  const cube = await prisma.asset.findMany({
    where: { isActive: true, category: { name: { contains: 'Cube', mode: 'insensitive' } } },
    select: { unitName: true, category: { select: { name: true } } },
    orderBy: { unitName: 'asc' },
  })
  console.log('\n=== Cube assets ===')
  for (const a of cube) console.log(`  [${a.category.name}] ${a.unitName}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
