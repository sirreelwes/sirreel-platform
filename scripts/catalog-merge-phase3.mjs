/**
 * Catalog merge, Phase 3 — point every child row at its new catalog row.
 *
 * Reads the id map Phase 2 wrote. Purely additive at the row level: the
 * legacy AssetCategory FKs (Asset.categoryId, BookingItem.categoryId,
 * VehicleCategory.assetCategoryId, RateChangeLog.assetCategoryId,
 * OrderLineItem.assetCategoryId) are left populated, so the app keeps
 * working unchanged until Phase 4 flips the readers — and rolling back
 * means ignoring the new column, not restoring data.
 *
 * RateChangeLog carries the rate-change audit trail. It already has an
 * inventoryItemId column, so its rows are pointed at the merged row
 * rather than rewritten; nothing is deleted. (CLAUDE.md's hard rules
 * exist because a rate-change audit row was once destroyed.)
 *
 * Idempotent — every write is "set the new column from the map", so
 * re-running lands on the same values.
 *
 * Run from the repo root:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   node scripts/catalog-merge-phase3.mjs
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const p = new PrismaClient();
const idMap = JSON.parse(
  readFileSync(new URL('./catalog-merge-idmap.json', import.meta.url), 'utf8')
);
const pairs = Object.entries(idMap);
console.log(`id map: ${pairs.length} AssetCategory -> InventoryItem\n`);

// Before-counts, so a mismatch after is loud rather than silent.
const before = {
  asset: await p.asset.count(),
  bookingItem: await p.bookingItem.count(),
  vehicleCategory: await p.vehicleCategory.count(),
  rateChangeLog: await p.rateChangeLog.count(),
  orderLineItem: await p.orderLineItem.count(),
};

let asset = 0,
  booking = 0,
  vehicle = 0,
  rateLog = 0,
  orderLine = 0;

for (const [oldId, newId] of pairs) {
  asset += (
    await p.asset.updateMany({
      where: { categoryId: oldId },
      data: { catalogItemId: newId },
    })
  ).count;

  booking += (
    await p.bookingItem.updateMany({
      where: { categoryId: oldId },
      data: { catalogItemId: newId },
    })
  ).count;

  vehicle += (
    await p.vehicleCategory.updateMany({
      where: { assetCategoryId: oldId },
      data: { catalogItemId: newId },
    })
  ).count;

  // Both of these already have an inventoryItemId column. Only fill it
  // where it's still empty — a row that already names an InventoryItem
  // is a genuine inventory row and must not be re-pointed.
  rateLog += (
    await p.rateChangeLog.updateMany({
      where: { assetCategoryId: oldId, inventoryItemId: null },
      data: { inventoryItemId: newId },
    })
  ).count;

  orderLine += (
    await p.orderLineItem.updateMany({
      where: { assetCategoryId: oldId, inventoryItemId: null },
      data: { inventoryItemId: newId },
    })
  ).count;
}

const after = {
  asset: await p.asset.count(),
  bookingItem: await p.bookingItem.count(),
  vehicleCategory: await p.vehicleCategory.count(),
  rateChangeLog: await p.rateChangeLog.count(),
  orderLineItem: await p.orderLineItem.count(),
};

console.log('backfilled:');
console.log(`  Asset.catalogItemId            ${asset}`);
console.log(`  BookingItem.catalogItemId      ${booking}`);
console.log(`  VehicleCategory.catalogItemId  ${vehicle}`);
console.log(`  RateChangeLog.inventoryItemId  ${rateLog}`);
console.log(`  OrderLineItem.inventoryItemId  ${orderLine}`);

// Nothing in this phase creates or removes rows.
const drift = Object.keys(before).filter((k) => before[k] !== after[k]);
console.log(
  drift.length
    ? `\n!! ROW COUNT DRIFT in ${drift.join(', ')} — investigate before continuing`
    : '\nrow counts unchanged across all five tables ✓'
);

// Orphan check: any child still pointing at an AssetCategory we didn't map.
const orphanAssets = await p.asset.count({ where: { catalogItemId: null } });
const orphanBookings = await p.bookingItem.count({ where: { catalogItemId: null } });
console.log(
  `unmapped after backfill — Asset: ${orphanAssets}, BookingItem: ${orphanBookings} (want 0, 0)`
);

await p.$disconnect();
