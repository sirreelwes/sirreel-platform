import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      affiliations: {
        include: { person: true },
        orderBy: { isCurrent: "desc" },
      },
      orders: {
        select: { id: true, orderNumber: true, status: true, total: true, description: true, startDate: true, endDate: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      activities: {
        include: { agent: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      },
    },
  });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(company);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const {
    name, website, industry, tier, billingEmail, defaultAgentId,
    coiOnFile, coiExpiry, notes,
    discountTendency, typicalDiscountPct, discountNotes,
  } = body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (website !== undefined) data.website = website;
  if (industry !== undefined) data.industry = industry;
  if (tier !== undefined) data.tier = tier;
  if (billingEmail !== undefined) data.billingEmail = billingEmail;
  if (defaultAgentId !== undefined) data.defaultAgentId = defaultAgentId || null;
  if (coiOnFile !== undefined) data.coiOnFile = coiOnFile;
  if (coiExpiry !== undefined) data.coiExpiry = coiExpiry ? new Date(coiExpiry) : null;
  if (notes !== undefined) data.notes = notes;
  // Discount profile — agent-edited from the client file. typicalDiscountPct
  // accepts null/empty to clear; non-empty values are coerced via Number().
  if (discountTendency !== undefined) data.discountTendency = discountTendency;
  if (typicalDiscountPct !== undefined) {
    data.typicalDiscountPct =
      typicalDiscountPct === null || typicalDiscountPct === '' ? null : Number(typicalDiscountPct);
  }
  if (discountNotes !== undefined) data.discountNotes = discountNotes || null;

  const company = await prisma.company.update({ where: { id }, data });
  return NextResponse.json(company);
}
