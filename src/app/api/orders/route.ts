import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nextOrderNumber, recalcOrderTotals } from "@/lib/orders";
import { getServerSession } from "next-auth";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const agentId = searchParams.get("agentId");
  const companyId = searchParams.get("companyId");
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "25");

  const where: Record<string, unknown> = {};

  if (status) where.status = status;
  if (agentId) where.agentId = agentId;
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
    const { companyId, bookingId, description, startDate, endDate, taxRate } = body;
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
        { error: "companyId and agentId are required", gotCompanyId: !!companyId, gotAgentId: !!agentId },
        { status: 400 }
      );
    }

    const orderNumber = await nextOrderNumber();

    const order = await prisma.order.create({
      data: {
        orderNumber,
        companyId,
        agentId,
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

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("Create order error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
