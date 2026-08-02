/**
 * Catalog merge, Phase 2 — fold the 13 AssetCategory rows into InventoryItem.
 *
 * Creates one UNIT_TRACKED InventoryItem per AssetCategory. Nothing is
 * deleted or mutated on the AssetCategory side: the old rows stay exactly
 * as they are so every existing FK keeps resolving while the readers are
 * cut over in Phase 4.
 *
 * Idempotent — upserts on the carried-over `slug`, so a re-run updates the
 * same rows rather than minting duplicates.
 *
 * Writes the old->new id map to scripts/catalog-merge-idmap.json, which
 * Phase 3 reads to backfill child FKs and which is the rollback record.
 *
 * Run from the repo root:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   node scripts/catalog-merge-phase2.mjs
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const p = new PrismaClient();

// AssetCategory.weeklyRate is nullable; InventoryItem.weeklyRate is not.
// Every populated row is exactly 5x daily (PopVan $400/$2,000), which is
// the house 5-day-per-week cap — so derive rather than write a zero, which
// would price a WEEKLY line at nothing.
const weekly = (ac) =>
  ac.weeklyRate != null ? ac.weeklyRate : Number(ac.dailyRate) * 5;

// Vehicles bill as VEHICLE lines; stages bill as EQUIPMENT in the STAGES
// department (LineItemType has no stage value — see lib/orders/stageLines).
const lineType = (dept) => (dept === 'VEHICLES' ? 'VEHICLE' : 'EQUIPMENT');

const cats = await p.assetCategory.findMany({ orderBy: { name: 'asc' } });
console.log(`AssetCategory rows to migrate: ${cats.length}`);

const idMap = {};
for (const ac of cats) {
  const code = 'CAT_' + ac.slug.toUpperCase().replace(/-/g, '_');
  const data = {
    code,
    slug: ac.slug,
    description: ac.name, // InventoryItem.description IS the display name
    catalogDescription: ac.description, // the public blurb
    trackingMode: 'UNIT_TRACKED',
    dailyRate: ac.dailyRate,
    weeklyRate: weekly(ac),
    department: ac.department,
    type: lineType(ac.department),
    qtyOwned: ac.totalUnits, // same meaning as totalUnits
    publicVisible: ac.isPublished, // same meaning as isPublished
    isActive: ac.isActive,
    archivedAt: ac.archivedAt,
    reservableOnGantt: ac.reservableOnGantt,
    region: ac.region,
    minRentalHours: ac.minRentalHours,
    maxRentalDays: ac.maxRentalDays,
    planyoResourceId: ac.planyoResourceId,
    rentalworksCategId: ac.rentalworksCategId,
    sortOrder: ac.sortOrder,
    aliases: ac.aliases,
    imageUrl: ac.imageUrl,
    needsReview: ac.needsReview,
    rwLastSyncedAt: ac.rwLastSyncedAt,
    rwId: ac.rwId,
  };

  const row = await p.inventoryItem.upsert({
    where: { slug: ac.slug },
    create: data,
    update: data,
  });
  idMap[ac.id] = row.id;
  console.log(
    `  ${ac.name.padEnd(26)} -> ${code.padEnd(28)} units=${ac.totalUnits} planyo=${ac.planyoResourceId ?? '-'}`
  );
}

writeFileSync(
  new URL('./catalog-merge-idmap.json', import.meta.url),
  JSON.stringify(idMap, null, 2)
);
console.log(`\nid map written: ${Object.keys(idMap).length} entries`);

await p.$disconnect();
