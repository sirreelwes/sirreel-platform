import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const personId = searchParams.get("personId");
  const pendingOnly = searchParams.get("pending") === "true";

  const where: Record<string, unknown> = {};
  if (companyId) where.companyId = companyId;
  if (personId) where.personId = personId;
  if (pendingOnly) {
    where.completed = false;
    where.dueDate = { not: null };
  }

  const activities = await prisma.activity.findMany({
    where,
    include: {
      agent: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      person: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: pendingOnly ? { dueDate: "asc" } : { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ activities });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { companyId, personId, bookingId, agentId, type, subject, body: text, dueDate } = body;

  if (!agentId || !text) {
    return NextResponse.json({ error: "agentId and body required" }, { status: 400 });
  }

  const activity = await prisma.activity.create({
    data: {
      companyId: companyId || null,
      personId: personId || null,
      bookingId: bookingId || null,
      agentId,
      type: type || "NOTE",
      subject: subject || null,
      body: text,
      dueDate: dueDate ? new Date(dueDate) : null,
    },
    include: {
      agent: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(activity, { status: 201 });
}
