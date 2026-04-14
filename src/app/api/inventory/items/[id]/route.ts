import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const { dailyRate, weeklyRate, qtyOwned, replacementCost, description, imageUrl } = body;

  const data: Record<string, unknown> = {};
  if (dailyRate !== undefined) data.dailyRate = parseFloat(dailyRate) || 0;
  if (weeklyRate !== undefined) data.weeklyRate = parseFloat(weeklyRate) || 0;
  if (qtyOwned !== undefined) data.qtyOwned = parseInt(qtyOwned) || 0;
  if (replacementCost !== undefined) data.replacementCost = replacementCost ? parseFloat(replacementCost) : null;
  if (description !== undefined) data.description = description;
  if (imageUrl !== undefined) data.imageUrl = imageUrl || null;

  const item = await prisma.inventoryItem.update({
    where: { id },
    data,
    include: { category: { select: { id: true, name: true } } },
  });

  return NextResponse.json(item);
}
