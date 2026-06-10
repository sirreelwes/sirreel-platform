import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const categorySlug = searchParams.get("category");
  const limit = parseInt(searchParams.get("limit") || "20");

  if (q.length < 2) {
    return NextResponse.json({ items: [] });
  }

  const where: Record<string, unknown> = {
    isActive: true,
    OR: [
      { code: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ],
  };

  if (categorySlug) {
    where.category = { slug: categorySlug };
  }

  // dailyRate + weeklyRate added to the projection so the order-detail
  // line-item form can auto-fill the rate field on inventory pick —
  // matches the AssetCategory selector's behavior (which has had rate
  // auto-fill since day one). Decimals serialize as strings; the page
  // coerces with Number().
  const items = await prisma.inventoryItem.findMany({
    where,
    select: {
      id: true,
      code: true,
      description: true,
      dailyRate: true,
      weeklyRate: true,
      category: { select: { id: true, name: true, slug: true } },
    },
    take: limit,
    orderBy: { code: "asc" },
  });

  return NextResponse.json({ items });
}
