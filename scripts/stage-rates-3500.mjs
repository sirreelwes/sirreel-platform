/**
 * Set every stage / standing set to $3,500/day (Wes, Aug 2 2026 — "make
 * all $3500/day for now").
 *
 * Scope is the SETS AND STAGES only, addressed by explicit code so this
 * can't quietly sweep in a neighbour. The STAGES department also holds
 * ancillary rooms ($125 offices and green rooms), the LED Wall Usage
 * add-on ($1,000), two parking rows and the two TEST fixtures — none of
 * those are stages and none are touched.
 *
 * Every rate change writes a RateChangeLog row (source MANUAL). That
 * table is the rate audit trail and is never bypassed.
 *
 * Studios is a merged AssetCategory row, so its rate is written to BOTH
 * sides of the mirror to match what the API routes do in-transaction.
 * Its weekly rate moves with it to preserve the existing 5x relationship
 * ($15,000 was exactly 5 x $3,000), the house week cap.
 *
 * Idempotent: a row already at the target is skipped, so a re-run writes
 * no duplicate audit rows.
 *
 * Run from the repo root:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   node scripts/stage-rates-3500.mjs
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const TARGET = 3500;

// Explicit allow-list. Nothing is matched by pattern.
const CODES = [
  'LANKERSHIM_POLICE_JAIL',
  'LANKERSHIM_MORGUE_SET',
  'LANKERSHIM_LED_VOLUME',
  'LANKERSHIM_BLACK_BOX',
  'LANKERSHIM_HOSPITAL_SET',
  'CAT_STUDIOS',
];

const applier = await p.user.findUnique({
  where: { email: 'wes@sirreel.com' },
  select: { id: true },
});

for (const code of CODES) {
  const item = await p.inventoryItem.findUnique({
    where: { code },
    select: {
      id: true,
      description: true,
      dailyRate: true,
      weeklyRate: true,
      legacyAssetCategoryId: true,
    },
  });
  if (!item) {
    console.log(`  SKIP  ${code} — not found`);
    continue;
  }

  const oldDaily = Number(item.dailyRate);
  const oldWeekly = Number(item.weeklyRate);
  if (oldDaily === TARGET) {
    console.log(`  same  ${(item.description || code).padEnd(20)} already $${TARGET}/day`);
    continue;
  }

  // Only carry the weekly rate along where one was actually configured;
  // a 0 means "not configured" and stays that way.
  const newWeekly = oldWeekly > 0 ? TARGET * 5 : oldWeekly;

  await p.$transaction(async (tx) => {
    await tx.inventoryItem.update({
      where: { id: item.id },
      data: { dailyRate: TARGET, weeklyRate: newWeekly },
    });

    // Merged rows are mirrored both ways by the API; do the same here so
    // the frozen AssetCategory copy can't drift out from under the
    // display surfaces still joining it.
    if (item.legacyAssetCategoryId) {
      await tx.assetCategory.update({
        where: { id: item.legacyAssetCategoryId },
        data: { dailyRate: TARGET, weeklyRate: newWeekly },
      });
    }

    await tx.rateChangeLog.create({
      data: {
        inventoryItemId: item.id,
        assetCategoryId: item.legacyAssetCategoryId,
        oldDailyRate: oldDaily,
        newDailyRate: TARGET,
        oldWeeklyRate: oldWeekly,
        newWeeklyRate: newWeekly,
        source: 'MANUAL',
        appliedById: applier?.id ?? null,
      },
    });
  });

  const weeklyNote = newWeekly !== oldWeekly ? ` · weekly $${oldWeekly} -> $${newWeekly}` : '';
  console.log(
    `  SET   ${(item.description || code).padEnd(20)} $${oldDaily} -> $${TARGET}/day${weeklyNote}`
  );
}

await p.$disconnect();
