import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeLineTotal, recalcOrderTotals } from "@/lib/orders";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;

  try {
    const body = await req.json();
    const {
      type, description, inventoryItemId, assetCategoryId,
      startDate, endDate, rateType = "DAILY", rate, quantity = 1, notes,
    } = body;

    if (!type || !description || rate === undefined) {
      return NextResponse.json(
        { error: "type, description, and rate are required" },
        { status: 400 }
      );
    }

    const maxSort = await prisma.orderLineItem.aggregate({
      where: { orderId },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    const { days, lineTotal } = computeLineTotal({
      rateType,
      rate: Number(rate),
      quantity,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
    });

    const lineItem = await prisma.orderLineItem.create({
      data: {
        orderId, sortOrder, type, description,
        inventoryItemId: inventoryItemId || null,
        assetCategoryId: assetCategoryId || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        rateType, rate, quantity, days, lineTotal,
        notes: notes || null,
      },
      include: {
        inventoryItem: { select: { id: true, code: true, description: true } },
        assetCategory: { select: { id: true, name: true } },
      },
    });

    const totals = await recalcOrderTotals(orderId);
    return NextResponse.json({ lineItem, totals }, { status: 201 });
  } catch (error) {
    console.error("Add line item error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
