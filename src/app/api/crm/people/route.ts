import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const people = await prisma.person.findMany({
    where,
    include: {
      affiliations: {
        where: { isCurrent: true },
        include: { company: { select: { id: true, name: true } } },
      },
    },
    orderBy: { totalSpend: "desc" },
    take: 100,
  });
  return NextResponse.json({ people });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { firstName, lastName, email, phone, mobile, role, tier, assignedAgentId } = body;
  if (!firstName || !lastName || !email) {
    return NextResponse.json({ error: "firstName, lastName, email required" }, { status: 400 });
  }

  const person = await prisma.person.create({
    data: { firstName, lastName, email, phone, mobile, role, tier, assignedAgentId },
  });
  return NextResponse.json(person, { status: 201 });
}
