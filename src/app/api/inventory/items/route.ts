import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const categoryId = searchParams.get("categoryId");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");

  const where: Record<string, unknown> = { isActive: true };

  if (categoryId) where.categoryId = categoryId;
  if (search) {
    where.OR = [
      { code: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const [items, total, categories] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: [{ category: { sortOrder: "asc" } }, { code: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.inventoryItem.count({ where }),
    prisma.inventoryCategory.findMany({
      select: { id: true, name: true, _count: { select: { items: true } } },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return NextResponse.json({ items, total, page, limit, categories });
}
