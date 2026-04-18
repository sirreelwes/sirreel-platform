import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeLineTotal, recalcOrderTotals } from "@/lib/orders";

type Params = { params: Promise<{ id: string; lineId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id: orderId, lineId } = await params;

  try {
    const body = await req.json();
    const {
      type, description, inventoryItemId, assetCategoryId,
      startDate, endDate, rateType, rate, quantity, sortOrder, notes, days: manualDays,
    } = body;

    const data: Record<string, unknown> = {};
    if (type !== undefined) data.type = type;
    if (description !== undefined) data.description = description;
    if (inventoryItemId !== undefined) data.inventoryItemId = inventoryItemId || null;
    if (assetCategoryId !== undefined) data.assetCategoryId = assetCategoryId || null;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (rateType !== undefined) data.rateType = rateType;
    if (rate !== undefined) data.rate = rate;
    if (quantity !== undefined) data.quantity = quantity;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (notes !== undefined) data.notes = notes || null;

    if (rateType !== undefined || rate !== undefined || quantity !== undefined || startDate !== undefined || endDate !== undefined || manualDays !== undefined) {
      const existing = await prisma.orderLineItem.findUnique({ where: { id: lineId } });
      if (existing) {
        const effectiveRateType = (rateType ?? existing.rateType) as "DAILY" | "WEEKLY" | "FLAT";
        const effectiveRate = Number(rate ?? existing.rate);
        const effectiveQty = quantity ?? existing.quantity;

        // If manualDays provided, compute lineTotal manually; otherwise let computeLineTotal do it
        if (manualDays !== undefined && manualDays !== null) {
          const d = parseFloat(String(manualDays)) || 0;
          let lineTotal = 0;
          if (effectiveRateType === "DAILY") {
            lineTotal = effectiveRate * d * effectiveQty;
          } else if (effectiveRateType === "WEEKLY") {
            lineTotal = effectiveRate * (d / 7) * effectiveQty;
          } else {
            lineTotal = effectiveRate * effectiveQty;
          }
          data.days = d;
          data.lineTotal = lineTotal;
        } else {
          const { days, lineTotal } = computeLineTotal({
            rateType: effectiveRateType,
            rate: effectiveRate,
            quantity: effectiveQty,
            startDate: startDate !== undefined ? (startDate ? new Date(startDate) : null) : existing.startDate,
            endDate: endDate !== undefined ? (endDate ? new Date(endDate) : null) : existing.endDate,
          });
          data.days = days;
          data.lineTotal = lineTotal;
        }
      }
    }

    const lineItem = await prisma.orderLineItem.update({
      where: { id: lineId },
      data,
      include: {
        inventoryItem: { select: { id: true, code: true, description: true } },
        assetCategory: { select: { id: true, name: true } },
      },
    });

    const totals = await recalcOrderTotals(orderId);
    return NextResponse.json({ lineItem, totals });
  } catch (error) {
    console.error("Update line item error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id: orderId, lineId } = await params;

  await prisma.orderLineItem.delete({ where: { id: lineId } });
  const totals = await recalcOrderTotals(orderId);
  return NextResponse.json({ success: true, totals });
}
