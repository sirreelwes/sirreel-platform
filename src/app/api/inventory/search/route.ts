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

  const items = await prisma.inventoryItem.findMany({
    where,
    include: {
      category: { select: { id: true, name: true, slug: true } },
    },
    take: limit,
    orderBy: { code: "asc" },
  });

  return NextResponse.json({ items });
}
