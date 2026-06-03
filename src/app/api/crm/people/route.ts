import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { computeCompanyBadgeFacts, type ClientBadge } from "@/lib/crm/clientBadges";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const people = await prisma.person.findMany({
    where,
    include: {
      affiliations: {
        where: { isCurrent: true },
        include: {
          company: {
            select: {
              id: true,
              name: true,
              tier: true,
              totalSpend: true,
              discountTendency: true,
              _count: { select: { orders: true } },
            },
          },
        },
      },
    },
    orderBy: { totalSpend: "desc" },
    take: 100,
  });

  // Collect distinct companyIds across all current affiliations of
  // the rendered People — one set, one rollup.
  const companyIds = Array.from(
    new Set(
      people.flatMap((p) => p.affiliations.map((a) => a.company.id)),
    ),
  );

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

  // Dedup company rows for the badge computation — each distinct
  // company is scored once, then mirrored across every Person
  // affiliated with it.
  const distinctCompanies = new Map<
    string,
    { id: string; totalSpend: number | string; orderCount: number; discountTendency: 'NONE' | 'OCCASIONAL' | 'FREQUENT' | 'ALWAYS' }
  >();
  for (const p of people) {
    for (const a of p.affiliations) {
      if (!distinctCompanies.has(a.company.id)) {
        distinctCompanies.set(a.company.id, {
          id: a.company.id,
          totalSpend: a.company.totalSpend.toString(),
          orderCount: a.company._count.orders,
          discountTendency: a.company.discountTendency,
        });
      }
    }
  }
  const badgeFacts = computeCompanyBadgeFacts(
    Array.from(distinctCompanies.values()),
    firstLast,
  );

  // Per-person FOLLOW_UP_DUE — a single Activity groupBy against the
  // page's personIds, predicate matches the strip's "pending" notion
  // (incomplete + dueDate on or before today).
  const peopleIds = people.map((p) => p.id);
  const now = new Date();
  const followUpRollup = peopleIds.length > 0
    ? await prisma.activity.groupBy({
        by: ['personId'],
        where: {
          personId: { in: peopleIds },
          completed: false,
          dueDate: { lte: now, not: null },
        },
        _count: { _all: true },
      })
    : [];
  const followUpDue = new Set<string>(
    followUpRollup
      .filter((r) => r.personId != null && r._count._all > 0)
      .map((r) => r.personId as string),
  );

  const enriched = people.map((p) => {
    // A person inherits badges from the FIRST current affiliation
    // (insertion order = affiliation create order, which is good
    // enough for "primary company"). Adding their own FOLLOW_UP_DUE
    // on top.
    const primary = p.affiliations[0]?.company;
    const inherited = primary ? badgeFacts.get(primary.id)?.badges ?? [] : [];
    const ownFlags: ClientBadge[] = followUpDue.has(p.id) ? ['FOLLOW_UP_DUE'] : [];
    return {
      ...p,
      badges: [...inherited, ...ownFlags],
      primaryCompanyId: primary?.id ?? null,
      primaryCompanyBadgeFacts: primary ? badgeFacts.get(primary.id) ?? null : null,
    };
  });

  return NextResponse.json({ people: enriched });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { firstName, lastName, email, phone, mobile, role, tier, assignedAgentId } = body;
  if (!firstName || !lastName || !email) {
    return NextResponse.json({ error: "firstName, lastName, email required" }, { status: 400 });
  }

  const person = await prisma.person.create({
    data: { firstName, lastName, email, phone, mobile, role, tier, assignedAgentId },
  });
  return NextResponse.json(person, { status: 201 });
}
