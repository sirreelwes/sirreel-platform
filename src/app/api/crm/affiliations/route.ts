import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const personId = searchParams.get("personId");
  const companyId = searchParams.get("companyId");

  const where: Record<string, unknown> = {};
  if (personId) where.personId = personId;
  if (companyId) where.companyId = companyId;

  const affiliations = await prisma.affiliation.findMany({
    where,
    include: {
      person: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      company: { select: { id: true, name: true, tier: true } },
    },
    orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
  });
  return NextResponse.json({ affiliations });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { personId, companyId, productionName, roleOnShow, startDate, endDate, isCurrent, notes } = body;

  if (!personId || !companyId) {
    return NextResponse.json({ error: "personId and companyId required" }, { status: 400 });
  }

  const affiliation = await prisma.affiliation.create({
    data: {
      personId,
      companyId,
      productionName: productionName || null,
      roleOnShow: roleOnShow || null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      isCurrent: isCurrent !== undefined ? isCurrent : true,
      notes: notes || null,
    },
    include: {
      person: { select: { id: true, firstName: true, lastName: true } },
      company: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(affiliation, { status: 201 });
}
