const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  try {
    await p.$executeRawUnsafe(`ALTER TYPE "Location" ADD VALUE IF NOT EXISTS 'NAPA'`);
    console.log("Added NAPA to Location enum");
  } catch(e) { console.log("NAPA: " + e.message.slice(0,80)); }

  // Move any CHESTNUT or LIMA refs to LANKERSHIM before removing
  await p.$executeRawUnsafe(`UPDATE "assets" SET "location" = 'LANKERSHIM' WHERE "location" IN ('CHESTNUT', 'LIMA')`);
  await p.$executeRawUnsafe(`UPDATE "inventory_items" SET "location" = 'LANKERSHIM' WHERE "location" IN ('CHESTNUT', 'LIMA')`);
  console.log("Migrated CHESTNUT/LIMA refs to LANKERSHIM");

  // Can't remove enum values in Postgres without recreating - leave them dormant
  console.log("Note: CHESTNUT and LIMA removed from schema/UI but remain in DB enum (Postgres limitation)");
  console.log("DONE");
  await p.$disconnect();
})();
