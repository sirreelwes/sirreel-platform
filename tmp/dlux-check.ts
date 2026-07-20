import { prisma } from '../src/lib/prisma'
async function main() {
  const a = await prisma.asset.findMany({ where: { category: { name: '2 Unit Restroom Trailer' } }, select: { unitName: true, isActive: true } })
  console.log(a)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
