import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const studiosCat = await p.assetCategory.findFirst({ where: { name: 'Studios' } })
  if (!studiosCat) throw new Error('Studios category not found')
  
  await p.asset.upsert({
    where: { id: 'seed-standing-sets' },
    update: {},
    create: {
      id: 'seed-standing-sets',
      categoryId: studiosCat.id,
      unitName: 'Standing Sets',
      notes: 'Hospital, Police and Morgue looks - Lankershim Studios. Exclusive use only, one booking at a time.',
      status: 'AVAILABLE',
      isActive: true,
    }
  })
  await p.asset.upsert({
    where: { id: 'seed-led-volume' },
    update: {},
    create: {
      id: 'seed-led-volume',
      categoryId: studiosCat.id,
      unitName: 'LED Volume Stage',
      notes: 'Lankershim Studios LED/Volume stage. Up to 2 simultaneous crews possible but requires coordination.',
      status: 'AVAILABLE',
      isActive: true,
    }
  })
  const count = await p.asset.count({ where: { categoryId: studiosCat.id } })
  console.log('Studio assets:', count)
  process.exit(0)
}
main().catch(console.error)
