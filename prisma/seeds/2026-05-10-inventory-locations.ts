// Seed + backfill InventoryLocation. Idempotent — safe to re-run.
// Run after `prisma db push` lands the new model + locationId column.
//
//   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
//   npx tsx prisma/seeds/2026-05-10-inventory-locations.ts

import { PrismaClient, Location as LocationEnum } from '@prisma/client';

const prisma = new PrismaClient();

// Display name + sort order for each legacy enum code.
// CHESTNUT and LIMA are marked legacy in the schema and inactive here.
const LOCATION_DEFS: Array<{ code: string; name: string; sortOrder: number; isActive: boolean }> = [
  { code: 'LANKERSHIM', name: 'Lankershim', sortOrder: 10, isActive: true },
  { code: 'NAPA',       name: 'Napa',       sortOrder: 20, isActive: true },
  { code: 'UTAH',       name: 'Utah',       sortOrder: 30, isActive: true },
  { code: 'ON_RENTAL',  name: 'On Rental',  sortOrder: 40, isActive: true },
  { code: 'IN_TRANSIT', name: 'In Transit', sortOrder: 50, isActive: true },
  { code: 'BODY_SHOP',  name: 'Body Shop',  sortOrder: 60, isActive: true },
  { code: 'HIGH_TECH',  name: 'High Tech',  sortOrder: 70, isActive: true },
  { code: 'CHESTNUT',   name: 'Chestnut',   sortOrder: 90, isActive: false },
  { code: 'LIMA',       name: 'Lima',       sortOrder: 91, isActive: false },
];

async function main() {
  console.log('Seeding InventoryLocation rows…');
  const byCode: Record<string, string> = {};
  for (const def of LOCATION_DEFS) {
    const row = await prisma.inventoryLocation.upsert({
      where: { code: def.code },
      update: { name: def.name, sortOrder: def.sortOrder, isActive: def.isActive },
      create: def,
      select: { id: true, code: true },
    });
    byCode[row.code] = row.id;
    console.log(`  • ${def.code} → ${row.id}`);
  }

  console.log('\nBackfilling InventoryItem.locationId from legacy enum…');
  let total = 0;
  for (const code of Object.keys(byCode)) {
    const result = await prisma.inventoryItem.updateMany({
      where: { location: code as LocationEnum, locationId: null },
      data: { locationId: byCode[code] },
    });
    if (result.count > 0) console.log(`  • ${code}: ${result.count} item(s) linked`);
    total += result.count;
  }
  console.log(`\nDone. Linked ${total} item(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
