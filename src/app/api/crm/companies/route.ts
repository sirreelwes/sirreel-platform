import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { computeCompanyBadgeFacts, fetchPopulationTopClientCutoff } from "@/lib/crm/clientBadges";

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

  // Single Order groupBy across the page's companyIds — gives us
  // first + last order date per company without an N+1. The
  // companyIds set is at most 100 (page take). Run the population
  // top-client cutoff in parallel so the badge means the same thing
  // on every page + filter (otherwise: cutoff drifts with the page).
  const companyIds = companies.map((c) => c.id);
  const [orderDateRollup, populationCutoff] = await Promise.all([
    companyIds.length > 0
      ? prisma.order.groupBy({
          by: ['companyId'],
          where: { companyId: { in: companyIds } },
          _min: { createdAt: true },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
    fetchPopulationTopClientCutoff(),
  ]);
  const firstLast = new Map(
    orderDateRollup.map((r) => [
      r.companyId,
      { companyId: r.companyId, firstOrderAt: r._min.createdAt, lastOrderAt: r._max.createdAt },
    ]),
  );

  const badgeFacts = computeCompanyBadgeFacts(
    companies.map((c) => ({
      id: c.id,
      totalSpend: c.totalSpend,
      orderCount: c._count.orders,
      discountTendency: c.discountTendency,
    })),
    firstLast,
    new Date(),
    populationCutoff,
  );

  const enriched = companies.map((c) => ({
    ...c,
    ...(badgeFacts.get(c.id) ?? { badges: [], firstOrderAt: null, lastOrderAt: null, loyalSinceYear: null }),
  }));

  return NextResponse.json({ companies: enriched });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { name, website, industry, tier, billingEmail, defaultAgentId } = body;
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const company = await prisma.company.create({
    data: { name, website, industry, tier, billingEmail, defaultAgentId },
  });
  return NextResponse.json(company, { status: 201 });
}
