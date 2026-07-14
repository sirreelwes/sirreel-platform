import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nextOrderNumber, recalcOrderTotals } from "@/lib/orders";
import { getServerSession } from "next-auth";
import { resolveDataScope, orderScopeWhere } from "@/lib/auth/scope";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const agentId = searchParams.get("agentId");
  const companyId = searchParams.get("companyId");
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "25");

  // Phase 6.5 — data scope enforcement. OWN users see only their own
  // orders regardless of any client-supplied agentId filter. ADMIN /
  // MANAGER always TEAM. Unauthenticated → empty result (sentinel).
  const scope = await resolveDataScope();
  const where: Record<string, unknown> = { ...orderScopeWhere(scope) };

  // Draft-hygiene filter (Phase A of order consolidation): the list
  // hides DRAFT rows by default so abandoned parses from the wizard
  // don't clutter the operational view. Explicit `status=DRAFT`
  // still works (the explicit filter wins), as does
  // `?includeDrafts=1` for the "Show drafts" toggle.
  const includeDrafts = searchParams.get("includeDrafts") === "1";
  if (status) {
    where.status = status;
  } else if (!includeDrafts) {
    where.status = { not: "DRAFT" };
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
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        company: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        booking: { select: { id: true, bookingNumber: true, jobName: true } },
        _count: { select: { lineItems: true, invoices: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({ orders, total, page, limit });
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
