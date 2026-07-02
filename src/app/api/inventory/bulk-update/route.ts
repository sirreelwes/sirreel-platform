import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-admin";
import { parseMoney } from "@/lib/pricing/resolveRate";

export async function POST(req: NextRequest) {
  // Bulk price mutation — ADMIN only (raw SQL below must be unreachable
  // without the role gate).
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;

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
    const col = Prisma.raw(columnMap[field]); // whitelisted above — safe to inline
    // Decimal-exact multiplier (audit §7): (100 + pct) / 100 computed in
    // Prisma.Decimal, passed as a bound ::numeric param — no float math,
    // no string interpolation. ROUND(…, 2) keeps cent precision in-DB.
    const pct = new Prisma.Decimal(String(percentage));
    if (!pct.isFinite()) {
      return NextResponse.json({ error: "percentage must be a number" }, { status: 400 });
    }
    const multiplier = pct.plus(100).div(100).toString();

    const result = categoryId
      ? await prisma.$executeRaw`UPDATE inventory_items SET ${col} = ROUND(${col} * ${multiplier}::numeric, 2), updated_at = NOW() WHERE category_id = ${categoryId} AND ${col} IS NOT NULL AND ${col} > 0`
      : await prisma.$executeRaw`UPDATE inventory_items SET ${col} = ROUND(${col} * ${multiplier}::numeric, 2), updated_at = NOW() WHERE ${col} IS NOT NULL AND ${col} > 0`;

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
    if (!columnMap[field]) {
      return NextResponse.json({ error: "Invalid field" }, { status: 400 });
    }
    const col = Prisma.raw(columnMap[field]); // whitelisted above — safe to inline
    // Decimal-safe (audit §7): cent-rounded Decimal as a bound param, no
    // parseFloat, no string interpolation.
    const rate = parseMoney(value);
    if (rate === null) {
      return NextResponse.json({ error: "value must be a number" }, { status: 400 });
    }

    const result = await prisma.$executeRaw`UPDATE inventory_items SET ${col} = ${rate.toString()}::numeric, updated_at = NOW() WHERE category_id = ${categoryId}`;

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
