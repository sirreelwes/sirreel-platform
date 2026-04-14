import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const orderId = searchParams.get("orderId");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (orderId) where.orderId = orderId;

  const subRentals = await prisma.subRental.findMany({
    where,
    include: {
      vendor: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true, description: true } },
      inventoryItem: { select: { id: true, code: true, description: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ subRentals });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    orderId, inventoryItemId, vendorId, itemDescription, quantity,
    startDate, endDate, vendorDailyRate, vendorWeeklyRate, vendorTotal,
    clientDailyRate, clientWeeklyRate, clientTotal, poNumber, notes,
  } = body;

  if (!vendorId || !itemDescription) {
    return NextResponse.json({ error: "vendorId and itemDescription required" }, { status: 400 });
  }

  const subRental = await prisma.subRental.create({
    data: {
      orderId: orderId || null,
      inventoryItemId: inventoryItemId || null,
      vendorId,
      itemDescription,
      quantity: quantity || 1,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      vendorDailyRate: vendorDailyRate || null,
      vendorWeeklyRate: vendorWeeklyRate || null,
      vendorTotal: vendorTotal || null,
      clientDailyRate: clientDailyRate || null,
      clientWeeklyRate: clientWeeklyRate || null,
      clientTotal: clientTotal || null,
      poNumber: poNumber || null,
      notes: notes || null,
    },
    include: {
      vendor: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true } },
    },
  });

  return NextResponse.json(subRental, { status: 201 });
}
