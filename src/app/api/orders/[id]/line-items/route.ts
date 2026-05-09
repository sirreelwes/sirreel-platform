import { NextRequest, NextResponse } from "next/server";
import type { LineItemDepartment, RateType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recalcOrderTotals, rentalDays as computeRentalDays } from "@/lib/orders";
import { computeLineTotal } from "@/lib/orders/billing";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;

  try {
    const body = await req.json();
    const {
      type, description, inventoryItemId, assetCategoryId,
      startDate, endDate, rateType = "DAILY", rate, quantity = 1, notes,
      department, qualifier, rentalDays,
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

    // Resolve days: prefer client-supplied rentalDays, fall back to the
    // start/end range, default 1.
    let days = 1;
    if (rentalDays != null && Number(rentalDays) > 0) {
      days = Math.floor(Number(rentalDays));
    } else if (startDate && endDate) {
      days = computeRentalDays(new Date(startDate), new Date(endDate));
    }

    // Department is required by the new billing rules. If the client
    // didn't pass one, try to lift it from the catalog product; final
    // fallback is PRO_SUPPLIES (matches the schema default).
    let resolvedDepartment: LineItemDepartment = (department as LineItemDepartment) || 'PRO_SUPPLIES';
    if (!department) {
      if (inventoryItemId) {
        const inv = await prisma.inventoryItem.findUnique({
          where: { id: inventoryItemId }, select: { department: true },
        });
        if (inv) resolvedDepartment = inv.department;
      } else if (assetCategoryId) {
        const ac = await prisma.assetCategory.findUnique({
          where: { id: assetCategoryId }, select: { department: true },
        });
        if (ac) resolvedDepartment = ac.department;
      }
    }

    const lineTotal = computeLineTotal({
      quantity: Number(quantity),
      rate: Number(rate),
      rentalDays: days,
      rateType: rateType as RateType,
      department: resolvedDepartment,
    });

    const lineItem = await prisma.orderLineItem.create({
      data: {
        orderId, sortOrder, type, description,
        inventoryItemId: inventoryItemId || null,
        assetCategoryId: assetCategoryId || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        rateType, rate, quantity, days,
        lineTotal: Math.round(lineTotal * 100) / 100,
        notes: notes || null,
        department: resolvedDepartment,
        ...(qualifier !== undefined ? { qualifier: qualifier || null } : {}),
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
