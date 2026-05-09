import { NextRequest, NextResponse } from "next/server";
import type { LineItemDepartment, RateType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recalcOrderTotals, rentalDays as computeRentalDays } from "@/lib/orders";
import { computeLineTotal } from "@/lib/orders/billing";

type Params = { params: Promise<{ id: string; lineId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id: orderId, lineId } = await params;

  try {
    const body = await req.json();
    const {
      type, description, inventoryItemId, assetCategoryId,
      startDate, endDate, rateType, rate, quantity, sortOrder, notes,
      days: manualDays, rentalDays, department, qualifier,
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
    if (department !== undefined) data.department = department;
    if (qualifier !== undefined) data.qualifier = qualifier || null;

    const explicitDays = rentalDays ?? manualDays;
    const dayInputProvided = explicitDays !== undefined && explicitDays !== null;
    if (
      rateType !== undefined || rate !== undefined || quantity !== undefined ||
      startDate !== undefined || endDate !== undefined || dayInputProvided ||
      department !== undefined || inventoryItemId !== undefined || assetCategoryId !== undefined
    ) {
      const existing = await prisma.orderLineItem.findUnique({ where: { id: lineId } });
      if (existing) {
        const effectiveRateType = (rateType ?? existing.rateType) as RateType;
        const effectiveRate = Number(rate ?? existing.rate);
        const effectiveQty = Number(quantity ?? existing.quantity);
        const effectiveDept = (department as LineItemDepartment | undefined) ?? existing.department;

        let effectiveDays = existing.days;
        if (dayInputProvided) {
          effectiveDays = Math.max(1, Math.floor(Number(explicitDays)));
        } else if (startDate !== undefined || endDate !== undefined) {
          const s = startDate !== undefined ? (startDate ? new Date(startDate) : null) : existing.startDate;
          const e = endDate !== undefined ? (endDate ? new Date(endDate) : null) : existing.endDate;
          if (s && e) effectiveDays = computeRentalDays(s, e);
        }

        const lineTotal = computeLineTotal({
          quantity: effectiveQty,
          rate: effectiveRate,
          rentalDays: effectiveDays,
          rateType: effectiveRateType,
          department: effectiveDept,
        });
        data.days = effectiveDays;
        data.lineTotal = Math.round(lineTotal * 100) / 100;
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
