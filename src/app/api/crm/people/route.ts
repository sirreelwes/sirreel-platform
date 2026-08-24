import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { computeCompanyBadgeFacts, fetchPopulationTopClientCutoff, type ClientBadge } from "@/lib/crm/clientBadges";
import { normalizeEmail } from "@/lib/people/email";

// PersonRole enum mirrored locally for runtime validation of the
// ?role= query param. Postgres rejects unknown enum values but we
// reject earlier so a typo returns 400 instead of 500.
const PERSON_ROLES = [
  'UPM', 'PRODUCER', 'LINE_PRODUCER', 'PRODUCTION_COORDINATOR',
  'PRODUCTION_SUPERVISOR', 'TRANSPORTATION_COORDINATOR', 'ART_COORDINATOR',
  'COORDINATOR', 'OWNER', 'OTHER',
] as const
type PersonRoleKey = (typeof PERSON_ROLES)[number]
const PERSON_ROLES_SET = new Set<string>(PERSON_ROLES)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const roleFilterRaw = searchParams.get("role");
  const roleFilter = roleFilterRaw && PERSON_ROLES_SET.has(roleFilterRaw)
    ? (roleFilterRaw as PersonRoleKey)
    : null;

  // ── Search clause — shared between the list query and the stats
  // groupBy so the chip counts reflect the SEARCHED subset (matches the
  // spec). Role filter is intentionally NOT included in the stats
  // clause — narrowing stats by the active role would zero every other
  // chip and defeat the point of showing the chip strip.
  // Multi-word queries are matched TOKEN BY TOKEN, each token having to
  // appear in one of the three fields. Matching the raw string against a
  // single column meant a properly-split contact could never be found by
  // their full name: "ian menzies" returned ZERO, because no one field
  // contains that string — firstName is "Ian", lastName is "Menzies".
  // (It only appeared to work for the many legacy rows that cram a whole
  // name into firstName with lastName ".".)
  const searchTokens = search.trim().split(/\s+/).filter(Boolean);
  const tokenClause = (t: string) => ({
    OR: [
      { firstName: { contains: t, mode: "insensitive" as const } },
      { lastName: { contains: t, mode: "insensitive" as const } },
      { email: { contains: t, mode: "insensitive" as const } },
    ],
  });
  const searchClause: Record<string, unknown> = {};
  if (searchTokens.length) {
    searchClause.AND = searchTokens.map(tokenClause);
  }
  // "Internal staff" exclusion for the COUNT only — the spec calls
  // this out as a counting rule, not a visibility rule, so the list
  // query below DOES NOT apply this filter (sirreel.com contacts still
  // appear in the People table).
  const statsClause = {
    ...searchClause,
    NOT: { email: { contains: '@sirreel.com', mode: 'insensitive' as const } },
  };
  const listClause: Record<string, unknown> = { ...searchClause };
  if (roleFilter) listClause.role = roleFilter;

  // ── Single groupBy for the role chip strip. One query, not N.
  const statsRaw = await prisma.person.groupBy({
    by: ['role'],
    where: statsClause,
    _count: { _all: true },
  });
  const byRole: Record<PersonRoleKey, number> = {
    UPM: 0, PRODUCER: 0, LINE_PRODUCER: 0, PRODUCTION_COORDINATOR: 0,
    PRODUCTION_SUPERVISOR: 0, TRANSPORTATION_COORDINATOR: 0, ART_COORDINATOR: 0,
    COORDINATOR: 0, OWNER: 0, OTHER: 0,
  };
  let statsTotal = 0;
  for (const row of statsRaw) {
    if (PERSON_ROLES_SET.has(row.role)) {
      byRole[row.role as PersonRoleKey] = row._count._all;
      statsTotal += row._count._all;
    }
  }
  const roleStats = { total: statsTotal, byRole };

  const people = await prisma.person.findMany({
    where: listClause,
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
    // While searching, over-fetch and rank below: token matching widens
    // the net ("ian m" matches anything with "ian" AND an "m"), and a
    // spend-ordered cap of 100 would bury or drop the exact person typed.
    take: searchTokens.length ? 400 : 100,
  });

  // Collect distinct companyIds across all current affiliations of
  // the rendered People — one set, one rollup.
  const companyIds = Array.from(
    new Set(
      people.flatMap((p) => p.affiliations.map((a) => a.company.id)),
    ),
  );

  // Order rollup + population top-client cutoff in parallel. The
  // cutoff is the same value /api/crm/stats hands the page strip, so
  // TOP_CLIENT means the same thing on every CRM surface.
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
    new Date(),
    populationCutoff,
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

  // ── Relevance ranking (search only) ──────────────────────────────
  // Token matching is deliberately generous, so order it so the person
  // actually typed is first. Without this, "ian menzies" could match and
  // still be invisible: the list is spend-ordered and nearly every
  // contact is $0, making position effectively random.
  if (searchTokens.length) {
    const q = search.trim().toLowerCase();
    const score = (p: { firstName?: string | null; lastName?: string | null; email?: string | null }) => {
      const first = (p.firstName ?? '').toLowerCase();
      const last = (p.lastName ?? '').toLowerCase();
      const email = (p.email ?? '').toLowerCase();
      // Legacy rows keep the whole name in firstName with lastName "."
      // — strip that so a full-name query scores the same either way.
      const full = `${first} ${last === '.' ? '' : last}`.trim();
      if (full === q) return 0;                       // exact person
      if (full.startsWith(q)) return 1;               // "ian men" → Ian Menzies
      if (first.startsWith(q) || last.startsWith(q)) return 2;
      if (email.startsWith(q)) return 3;
      if (full.includes(q)) return 4;
      return 5;                                       // token-only match
    };
    enriched.sort((a, b) => {
      const d = score(a) - score(b);
      if (d !== 0) return d;
      // Within a tier keep the previous behaviour: bigger clients first.
      const spend = Number(b.totalSpend ?? 0) - Number(a.totalSpend ?? 0);
      if (spend !== 0) return spend;
      return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    });
    return NextResponse.json({ people: enriched.slice(0, 100), roleStats });
  }

  return NextResponse.json({ people: enriched, roleStats });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { firstName, lastName, email, phone, mobile, role, tier, assignedAgentId, source } = body;
  if (!firstName || !lastName || !email) {
    return NextResponse.json({ error: "firstName, lastName, email required" }, { status: 400 });
  }

  const person = await prisma.person.create({
    data: {
      firstName, lastName,
      // Lowercase + trim at the boundary. The original case-variant
      // dupe ("Wes@" vs "wes@") slipped past Person.email's @unique
      // because Postgres indexes are case-sensitive. See
      // src/lib/people/email.ts.
      email: normalizeEmail(email),
      phone, mobile, role, tier, assignedAgentId,
      // Free-form provenance tag — the new-quote inline create stamps
      // "phone_inquiry" for off-email leads; the capture pipeline
      // stamps "email_capture"; manual /crm adds leave it null.
      source: typeof source === 'string' && source.trim() ? source.trim() : null,
    },
  });
  return NextResponse.json(person, { status: 201 });
}
