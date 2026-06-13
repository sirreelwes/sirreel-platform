import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import {
  computeCompanyBadgeFacts,
  fetchPopulationTopClientCutoff,
  QUIET_DAYS,
} from "@/lib/crm/clientBadges";
import { companyNameKey } from "@/lib/companies/normalize";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const tier = searchParams.get("tier");
  const sort = searchParams.get("sort") || "spend";
  // Sales-segment chips. Filtering happens BEFORE take:100 so the
  // chip operates on the full population (the loaded slice is the
  // top-100 within the segment). Counts for the chip labels come
  // from /api/crm/stats so they don't drift with the slice.
  const segment = searchParams.get("segment");

  const where: Record<string, unknown> = {};
  if (tier) where.tier = tier;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { billingEmail: { contains: search, mode: "insensitive" } },
    ];
  }

  // Pre-compute the population cutoff once — used by both the
  // segment filter (when segment === 'topClients') and the badge
  // facts below. Saves a second ordered scan for the topClients case.
  const populationCutoff = await fetchPopulationTopClientCutoff();

  if (segment === 'topClients') {
    // Cutoff 0 = no spenders in the population → empty result.
    if (populationCutoff > 0) {
      where.totalSpend = { gte: populationCutoff };
    } else {
      where.id = { in: [] };
    }
  } else if (segment === 'neverOrdered') {
    where.orders = { none: {} };
  } else if (segment === 'quiet') {
    // Companies whose MAX(order.createdAt) is before the quiet
    // cutoff. Prisma can't filter on aggregate directly, so a
    // single Order groupBy returns the qualifying companyIds.
    // Same logic as /api/crm/stats so the chip count matches.
    const quietCutoff = new Date();
    quietCutoff.setDate(quietCutoff.getDate() - QUIET_DAYS);
    const rollup = await prisma.order.groupBy({
      by: ['companyId'],
      _max: { createdAt: true },
    });
    const quietIds = rollup
      .filter((r) => r._max.createdAt && r._max.createdAt <= quietCutoff)
      .map((r) => r.companyId);
    where.id = { in: quietIds };
  } else if (segment === 'discount') {
    where.discountTendency = { in: ['FREQUENT', 'ALWAYS'] };
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
  // companyIds set is at most 100 (page take). The population
  // top-client cutoff was already fetched above (drives both the
  // segment filter + badge facts).
  const companyIds = companies.map((c) => c.id);
  const orderDateRollup = companyIds.length > 0
    ? await prisma.order.groupBy({
        by: ['companyId'],
        where: { companyId: { in: companyIds } },
        _min: { createdAt: true },
        _max: { createdAt: true },
      })
    : [];
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

  // Normalized-key dupe guard (STEP 1B) — the create-time analog of
  // the email-normalize root-cause fix. We compute the normalized
  // form ("Rema Films LLC" → "rema films") and scan existing
  // companies for a match before inserting. If a near-match exists,
  // we return it as a 409 with the existing row so the caller can
  // surface it to the human ("Did you mean X?") — never auto-merge.
  // The caller can override by passing `allowNearMatch: true` if the
  // human explicitly confirms the name collision is intentional.
  const allowNearMatch = body?.allowNearMatch === true;
  if (!allowNearMatch) {
    const targetKey = companyNameKey(name);
    if (targetKey) {
      // Walk every Company name — cheap at our scale (~hundreds of
      // rows). At thousands we'd add a generated/normalized column
      // and index; not warranted yet.
      const all = await prisma.company.findMany({
        select: { id: true, name: true, tier: true, billingEmail: true },
      });
      const collision = all.find((c) => companyNameKey(c.name) === targetKey);
      if (collision) {
        return NextResponse.json(
          {
            error: 'near_match',
            message: `A company with a similar name already exists: "${collision.name}". Confirm or use the existing one.`,
            existing: collision,
            normalizedKey: targetKey,
          },
          { status: 409 },
        );
      }
    }
  }

  const company = await prisma.company.create({
    data: { name, website, industry, tier, billingEmail, defaultAgentId },
  });
  return NextResponse.json(company, { status: 201 });
}
