import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companySearch = searchParams.get("company") || "";

  const [companies, agents, assetCategories, inventoryCategories] = await Promise.all([
    prisma.company.findMany({
      where: companySearch
        ? { name: { contains: companySearch, mode: "insensitive" } }
        : {},
      select: { id: true, name: true, tier: true },
      orderBy: { name: "asc" },
      take: 50,
    }),
    prisma.user.findMany({
      // MANAGER included: Hugo, Julian and Albert run orders, and an
      // order's agent is whose name and reply-to reach the client.
      // Leaving them out meant an order they handle could not be
      // assigned to them.
      where: { role: { in: ["ADMIN", "AGENT", "MANAGER"] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    // Post catalog merge these are unit-tracked InventoryItems. The
    // response key stays `assetCategories` — it is what the order page's
    // vehicle picker reads — but the ids are catalog ids and bind to
    // inventoryItemId.
    //
    // NOT gated on publicVisible. The merge (4c2185bf) carried the frozen
    // AssetCategory.isPublished across as publicVisible on the assumption
    // they meant the same thing. They don't: publicVisible is the
    // sirreel.com gate the publish desk owns, and it is false on all 17
    // unit-tracked rows — so this returned an EMPTY list and the order
    // page's "Select vehicle…" dropdown has had nothing in it since
    // 2026-08-02. Reps fell through to the catalog combobox, which is why
    // nobody reported it.
    //
    // isPublished was no better a rule anyway: it was true on a retired
    // 12-passenger van and on Lankershim Studios (a stage), and false on
    // three trucks we rent. Nothing maintains it — the table is frozen.
    // The honest staff rule is what a rep can actually put on an order:
    // every active unit-tracked row the catalog itself calls a VEHICLE.
    // That is the 10 live classes, stages excluded (they are booked
    // through Make Reservation) and the retired rows out with isActive.
    prisma.inventoryItem.findMany({
      where: { trackingMode: "UNIT_TRACKED", isActive: true, type: "VEHICLE" },
      select: {
        id: true, code: true, description: true, slug: true,
        dailyRate: true, weeklyRate: true, department: true, type: true,
      },
      orderBy: { description: "asc" },
    }),
    prisma.inventoryCategory.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return NextResponse.json({
    companies,
    agents,
    assetCategories: assetCategories.map((c) => ({
      id: c.id,
      name: c.description || c.code,
      slug: c.slug,
      dailyRate: c.dailyRate,
      weeklyRate: c.weeklyRate,
      // Travel with the row so the picker derives the line's type the way
      // every other door does (src/lib/orders/lineType.ts) instead of
      // assuming everything in this list is a truck.
      department: c.department,
      lineType: c.type,
    })),
    inventoryCategories,
  });
}
