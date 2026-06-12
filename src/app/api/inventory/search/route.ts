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

  // Token-based matching. Split the query on whitespace, AND each token
  // against (code OR description) — order doesn't matter, every token
  // must hit SOMEWHERE in either field. "6' Table" → "6' Folding Table"
  // (both "6'" and "Table" appear), "sandbag" → "25 LB. SANDBAG"
  // (case-insensitive contains).
  //
  // Single-token queries collapse to the same single OR clause the old
  // path used; no regression on existing call sites.
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  const where: Record<string, unknown> = {
    isActive: true,
    AND: tokens.map((t) => ({
      OR: [
        { code: { contains: t, mode: "insensitive" } },
        { description: { contains: t, mode: "insensitive" } },
      ],
    })),
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
