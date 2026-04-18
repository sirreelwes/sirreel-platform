import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const tier = searchParams.get("tier");
  const sort = searchParams.get("sort") || "spend";

  const where: Record<string, unknown> = {};
  if (tier) where.tier = tier;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { billingEmail: { contains: search, mode: "insensitive" } },
    ];
  }

  const orderBy = sort === "name" ? { name: "asc" as const }
    : sort === "recent" ? { updatedAt: "desc" as const }
    : { totalSpend: "desc" as const };

  const companies = await prisma.company.findMany({
    where,
    include: {
      _count: { select: { orders: true } },
      affiliations: {
        where: { isCurrent: true },
        include: { person: { select: { id: true, firstName: true, lastName: true, role: true, email: true, phone: true } } },
        take: 5,
      },
    },
    orderBy,
    take: 100,
  });

  return NextResponse.json({ companies });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, website, industry, tier, billingEmail, defaultAgentId } = body;
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const company = await prisma.company.create({
    data: { name, website, industry, tier, billingEmail, defaultAgentId },
  });
  return NextResponse.json(company, { status: 201 });
}
