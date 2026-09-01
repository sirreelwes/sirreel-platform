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
    // inventoryItemId. isPublished became publicVisible in the merge.
    prisma.inventoryItem.findMany({
      where: { trackingMode: "UNIT_TRACKED", publicVisible: true, isActive: true },
      select: { id: true, code: true, description: true, slug: true, dailyRate: true, weeklyRate: true },
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
    })),
    inventoryCategories,
  });
}
