import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nextOrderNumber, recalcOrderTotals } from "@/lib/orders";
import { getServerSession } from "next-auth";
import { resolveDataScope, orderScopeWhere } from "@/lib/auth/scope";

/**
 * Sort options for the /orders list. `startDate` uses Prisma's explicit
 * nulls-last ordering — an order with no pickup date is not "the earliest
 * pickup", and the default null-first ordering put every undated row at the
 * top of the exact view a rep opens to see what's shipping next.
 */
const SORTS: Record<string, Record<string, unknown>[]> = {
  recent:  [{ createdAt: 'desc' }],
  pickup:  [{ startDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
  value:   [{ total: 'desc' }],
  company: [{ company: { name: 'asc' } }, { createdAt: 'desc' }],
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const agentId = searchParams.get("agentId");
  const companyId = searchParams.get("companyId");
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "25");
  const sort = searchParams.get("sort") || "recent";

  // Phase 6.5 — data scope enforcement. OWN users see only their own
  // orders regardless of any client-supplied agentId filter. ADMIN /
  // MANAGER always TEAM. Unauthenticated → empty result (sentinel).
  const scope = await resolveDataScope();
  const where: Record<string, unknown> = { ...orderScopeWhere(scope) };

  // Soft-archive filter, mirroring /api/jobs. Archived orders are hidden
  // everywhere by default — the whole point of the action is that the row
  // stops appearing — and `archived=1` is the only way to see them, which
  // is what the "Archived" option in the list filter asks for.
  const archivedOnly = searchParams.get("archived") === "1";
  where.archivedAt = archivedOnly ? { not: null } : null;

  // Draft-hygiene filter (Phase A of order consolidation): the list
  // hides DRAFT rows by default so abandoned parses from the wizard
  // don't clutter the operational view. Explicit `status=DRAFT`
  // still works (the explicit filter wins), as does
  // `?includeDrafts=1` for the "Show drafts" toggle.
  const includeDrafts = searchParams.get("includeDrafts") === "1";

  // LOST is not an OrderStatus — the cadence runner and the mark-lost
  // action both express it as quoteStatus + lostAt while `status` stays
  // put (a lost quote is still a quote that was sent). So the filter has
  // to translate: `status=LOST` is a quoteStatus query, and every other
  // value is a lifecycle query that must EXCLUDE the lost rows, or a
  // dead quote keeps answering to "Quote sent" here the way it always has.
  const lostWhere = { quoteStatus: 'LOST' as const, status: { not: 'CANCELLED' as const } };
  if (status === 'LOST') {
    Object.assign(where, lostWhere);
  } else if (status) {
    where.status = status;
    where.NOT = lostWhere;
  } else {
    where.NOT = lostWhere;
    if (!includeDrafts) where.status = { not: "DRAFT" };
  }
  // Client-opted agentId filter — only honored when it matches the
  // user's scope. For OWN users we already constrained to their id;
  // an explicit agentId param against a different user is ignored to
  // prevent client-side spoofing.
  if (agentId && scope.scope === 'TEAM') where.agentId = agentId;
  if (companyId) where.companyId = companyId;
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { company: { name: { contains: search, mode: "insensitive" } } },
      // Reps search by production, and the production name lives on the
      // Job — half the rows on this list have a null description and read
      // as "--", so company-or-order-number was the only way to find them.
      { job: { name: { contains: search, mode: "insensitive" } } },
      { job: { jobCode: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [orders, total, valueAgg] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        company: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        job: { select: { id: true, jobCode: true, name: true } },
        booking: { select: { id: true, bookingNumber: true, jobName: true } },
        _count: { select: { lineItems: true, invoices: true } },
      },
      orderBy: SORTS[sort] || SORTS.recent,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
    // Value of the WHOLE filtered set, not just the visible page — "what is
    // on this list worth" is the question the header was silently failing to
    // answer, and page-1-only would have answered it wrong.
    prisma.order.aggregate({ where, _sum: { total: true } }),
  ]);

  return NextResponse.json({
    orders,
    total,
    page,
    limit,
    valueTotal: valueAgg._sum.total ?? 0,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { companyId, jobId, bookingId, description, startDate, endDate, taxRate } = body;
    let { agentId } = body;

    // Fall back to logged-in user for agentId if not supplied
    if (!agentId) {
      const session = await getServerSession();
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
        if (user) agentId = user.id;
      }
    }

    if (!companyId || !agentId) {
      return NextResponse.json(
        {
          error: "companyId and agentId are required",
          gotCompanyId: !!companyId,
          gotAgentId: !!agentId,
        },
        { status: 400 }
      );
    }

    // Job-as-root (step 4): orders NEVER create Jobs. The inline `job`
    // payload is CLOSED — the new-quote wizard resolves the Job through
    // JobResolverModal (createJobFromDraft is the one creation home)
    // before this endpoint is called.
    if (!jobId) {
      return NextResponse.json(
        { error: "jobId required — resolve or create the Job first (Job-as-root)" },
        { status: 400 }
      );
    }
    if (body.job) {
      return NextResponse.json(
        { error: "inline job creation was removed — resolve the Job via the resolver, then pass jobId" },
        { status: 400 }
      );
    }

    // Inverted-range guard. Without this, the line-items POST
    // inherits these bogus dates and every line collapses to days=1
    // via the silent Math.max(1, …) downstream. Fail at the order
    // boundary so the rep fixes it once.
    if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      if (
        Number.isFinite(s.getTime()) &&
        Number.isFinite(e.getTime()) &&
        e.getTime() < s.getTime()
      ) {
        return NextResponse.json(
          {
            error: "invalid date range",
            reason: `Order end date (${e.toISOString().slice(0, 10)}) is before start date (${s.toISOString().slice(0, 10)}).`,
          },
          { status: 400 },
        );
      }
    }

    const { order } = await prisma.$transaction(async (tx) => {
      // Order number lives INSIDE the tx now that the per-day counter
      // backs it — a rolled-back order rolls back its number too, so
      // there are no daily-counter gaps from aborted creates.
      const orderNumber = await nextOrderNumber(tx);

      const created = await tx.order.create({
        data: {
          orderNumber,
          companyId,
          agentId,
          jobId,
          bookingId: bookingId || null,
          description: description || null,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          taxRate: taxRate ?? 0,
        },
        include: {
          company: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true } },
        },
      });
      return { order: created };
    });

    return NextResponse.json({ ...order }, { status: 201 });
  } catch (error) {
    console.error("Create order error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
