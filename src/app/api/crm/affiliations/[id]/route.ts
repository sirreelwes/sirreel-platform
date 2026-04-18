import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.affiliation.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const { productionName, roleOnShow, startDate, endDate, isCurrent, notes } = body;

  const data: Record<string, unknown> = {};
  if (productionName !== undefined) data.productionName = productionName || null;
  if (roleOnShow !== undefined) data.roleOnShow = roleOnShow || null;
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
  if (isCurrent !== undefined) data.isCurrent = isCurrent;
  if (notes !== undefined) data.notes = notes;

  const affiliation = await prisma.affiliation.update({ where: { id }, data });
  return NextResponse.json(affiliation);
}
