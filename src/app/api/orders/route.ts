import { NextRequest, NextResponse } from "next/server";
import { requireOrderCreateAccess } from '@/lib/orders/requireOrderCreateAccess';
import { prisma } from "@/lib/prisma";
import { clientCreatedDraftOrderIds } from '@/lib/sales/clientCreatedJobs';
import { nextOrderNumber, recalcOrderTotals } from "@/lib/orders";
import { applyStandingDiscounts } from "@/lib/orders/applyStandingDiscounts";
import { getServerSession } from "next-auth";
import { resolveDataScope, orderScopeWhere } from "@/lib/auth/scope";
import { isYmd, pacificRange } from "@/lib/time/pacificDay";
import { tallyOrderDay } from "@/lib/orders/dayTally";

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
    if (!includeDrafts) {
      // ...but a DRAFT the CLIENT created on the public rental-agreement
      // page is not an abandoned wizard parse. It is a real production
      // waiting on a quote, sometimes with the rental agreement already
      // signed against it, and hiding it is why SR-JOB-0315 could not be
      // found in this list at all (Wes 2026-09-08: "i don't see that
      // order anywhere in orders").
      //
      // Scoped by the same marker every other client-created surface
      // uses — an AgreementEntry that minted the inquiry this job came
      // from (src/lib/sales/clientCreatedJobs.ts). Written as AND so it
      // composes with the search OR below rather than fighting it.
      const clientCreated = await clientCreatedDraftOrderIds();
      where.AND = [
        {
          OR: [
            { status: { not: "DRAFT" as const } },
            ...(clientCreated.length ? [{ id: { in: clientCreated } }] : []),
          ],
        },
      ];
    }
  }
  // Created-on filter (Ana, 2026-09-17: "specify a certain date … confirm how
  // many orders and quotes were created each day"). Pacific days, both ends
  // inclusive; one of the two is enough, and a single day is from === to.
  //
  // PACIFIC, not UTC, because the day this has to agree with is the EOD
  // report's day — a UTC cut would move every order written after 4pm into
  // tomorrow's count and the two screens would disagree every evening.
  const createdFrom = searchParams.get("createdFrom");
  const createdTo = searchParams.get("createdTo");
  const dayFrom = isYmd(createdFrom) ? createdFrom : isYmd(createdTo) ? createdTo : null;
  const dayTo = isYmd(createdTo) ? createdTo : isYmd(createdFrom) ? createdFrom : null;
  // Named dayWindow, not window — this is a server module, but shadowing a
  // global that means something else everywhere reads as a mistake.
  const dayWindow = dayFrom && dayTo ? pacificRange(dayFrom, dayTo) : null;
  if (dayWindow) where.createdAt = { gte: dayWindow.start, lt: dayWindow.end };

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

  // The day's figures on the EOD report's own basis — every order created in
  // the window, whatever the rep has filtered the table to. Deliberately NOT
  // derived from `where`: the point of the card is to check the report, so a
  // status filter or the hidden-drafts rule must not move its numbers. Scope
  // is the one thing it does inherit, because showing a rep somebody else's
  // orders in a total is a different leak.
  const dayRowsPromise = dayWindow
    ? prisma.order.findMany({
        where: {
          ...orderScopeWhere(scope),
          createdAt: { gte: dayWindow.start, lt: dayWindow.end },
        },
        select: { total: true, bookedTotal: true, quoteStatus: true, status: true, archivedAt: true },
      })
    : Promise.resolve(null);

  const [orders, total, valueAgg, dayRows] = await Promise.all([
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
    dayRowsPromise,
  ]);

  return NextResponse.json({
    orders,
    total,
    page,
    limit,
    valueTotal: valueAgg._sum.total ?? 0,
    dayTally: dayRows ? { from: dayFrom, to: dayTo, ...tallyOrderDay(dayRows) } : null,
  });
}

export async function POST(req: NextRequest) {
  try {
    // Sales + admin only (Hugo, 2026-09-03). This route had no role
    // check at all; the yard crew simply had no nav entry pointing at
    // it, which is not the same as being unable to reach it.
    const gate = await requireOrderCreateAccess();
    if (gate instanceof NextResponse) return gate;

    const body = await req.json();
    const {
      companyId, jobId, bookingId, description, startDate, endDate, taxRate,
      // Answered at the desk when the window lands on a day the yard is
      // closed — see ClosedDayHandoffPrompt. The same two columns the
      // order page's Blind handoff card writes; instructions are typed
      // there, not here.
      blindPickup, blindReturn,
      // "A warehouse order is coming on this reservation" (Wes
      // 2026-09-14) — a vehicle-only reservation saying it is not the
      // whole job. See Order.warehouseOrderExpected.
      warehouseOrderExpected,
    } = body;
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
          blindPickup: !!blindPickup,
          blindReturn: !!blindReturn,
          warehouseOrderExpected: !!warehouseOrderExpected,
        },
        include: {
          company: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true } },
        },
      });
      // The client's standing discounts become rows on THIS order, inside
      // the same transaction — a rolled-back order takes them with it.
      await applyStandingDiscounts(created.id, companyId, tx);
      return { order: created };
    });

    return NextResponse.json({ ...order }, { status: 201 });
  } catch (error) {
    console.error("Create order error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
