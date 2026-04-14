import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const vendors = await prisma.vendor.findMany({
    where: { isActive: true },
    include: { _count: { select: { subRentals: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ vendors });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, contactName, email, phone, website, notes } = body;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const vendor = await prisma.vendor.create({
    data: { name, contactName, email, phone, website, notes },
  });
  return NextResponse.json(vendor, { status: 201 });
}
