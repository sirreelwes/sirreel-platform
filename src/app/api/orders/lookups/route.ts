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
      where: { role: { in: ["ADMIN", "AGENT"] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.assetCategory.findMany({
      where: { isPublished: true },
      select: { id: true, name: true, slug: true, dailyRate: true, weeklyRate: true },
      orderBy: { name: "asc" },
    }),
    prisma.inventoryCategory.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return NextResponse.json({
    companies,
    agents,
    assetCategories,
    inventoryCategories,
  });
}
