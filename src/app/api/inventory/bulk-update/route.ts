import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, categoryId, percentage, field } = body;

  // action: "percentage_change"
  // field: "dailyRate" | "weeklyRate" | "replacementCost"
  // percentage: number (e.g. 10 for +10%, -5 for -5%)
  // categoryId: optional - if omitted, applies to all

  if (action === "percentage_change") {
    if (!percentage || !field) {
      return NextResponse.json({ error: "percentage and field required" }, { status: 400 });
    }

    const validFields = ["dailyRate", "weeklyRate", "replacementCost"];
    if (!validFields.includes(field)) {
      return NextResponse.json({ error: "field must be dailyRate, weeklyRate, or replacementCost" }, { status: 400 });
    }

    const columnMap: Record<string, string> = {
      dailyRate: "daily_rate",
      weeklyRate: "weekly_rate",
      replacementCost: "replacement_cost",
    };
    const col = columnMap[field];
    const multiplier = 1 + (percentage / 100);

    const whereClause = categoryId
      ? `WHERE category_id = '${categoryId}' AND ${col} IS NOT NULL AND ${col} > 0`
      : `WHERE ${col} IS NOT NULL AND ${col} > 0`;

    const result = await prisma.$executeRawUnsafe(
      `UPDATE inventory_items SET ${col} = ROUND(${col} * ${multiplier}, 2), updated_at = NOW() ${whereClause}`
    );

    return NextResponse.json({
      success: true,
      message: `Updated ${col} by ${percentage > 0 ? "+" : ""}${percentage}%`,
      rowsAffected: result,
    });
  }

  // action: "set_rate" - set a specific rate for all items in a category
  if (action === "set_rate") {
    const { value } = body;
    if (!field || value === undefined || !categoryId) {
      return NextResponse.json({ error: "field, value, and categoryId required" }, { status: 400 });
    }

    const columnMap: Record<string, string> = {
      dailyRate: "daily_rate",
      weeklyRate: "weekly_rate",
      replacementCost: "replacement_cost",
    };
    const col = columnMap[field];
    if (!col) {
      return NextResponse.json({ error: "Invalid field" }, { status: 400 });
    }

    const result = await prisma.$executeRawUnsafe(
      `UPDATE inventory_items SET ${col} = ${parseFloat(value)}, updated_at = NOW() WHERE category_id = '${categoryId}'`
    );

    return NextResponse.json({ success: true, rowsAffected: result });
  }

  if (action === "reassign_category") {
    const { itemIds, categoryId: targetCatId } = body;
    if (!itemIds?.length || !targetCatId) {
      return NextResponse.json({ error: "itemIds and categoryId required" }, { status: 400 });
    }

    const result = await prisma.inventoryItem.updateMany({
      where: { id: { in: itemIds } },
      data: { categoryId: targetCatId },
    });

    return NextResponse.json({ success: true, rowsAffected: result.count });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
