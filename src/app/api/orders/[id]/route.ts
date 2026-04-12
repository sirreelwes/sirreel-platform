import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalcOrderTotals } from "@/lib/orders";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      company: true,
      agent: { select: { id: true, name: true, email: true } },
      booking: { select: { id: true, bookingNumber: true, jobName: true, productionName: true } },
      lineItems: {
        include: {
          inventoryItem: { select: { id: true, code: true, description: true } },
          assetCategory: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
      invoices: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json(order);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const body = await req.json();
    const { status, description, startDate, endDate, taxRate, notes, companyId, agentId, bookingId } = body;

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (description !== undefined) data.description = description;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (taxRate !== undefined) data.taxRate = taxRate;
    if (notes !== undefined) data.notes = notes;
    if (companyId !== undefined) data.companyId = companyId;
    if (agentId !== undefined) data.agentId = agentId;
    if (bookingId !== undefined) data.bookingId = bookingId || null;

    const order = await prisma.order.update({
      where: { id },
      data,
      include: {
        company: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
      },
    });

    if (taxRate !== undefined) {
      await recalcOrderTotals(id);
    }

    return NextResponse.json(order);
  } catch (error) {
    console.error("Update order error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Only DRAFT orders can be deleted" },
      { status: 400 }
    );
  }

  await prisma.order.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
