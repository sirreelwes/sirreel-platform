import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      affiliations: {
        include: { company: { select: { id: true, name: true, tier: true } } },
        orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
      },
      activities: {
        include: {
          agent: { select: { id: true, name: true } },
          company: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(person);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const { firstName, lastName, email, phone, mobile, role, tier, assignedAgentId, notes } = body;

  const data: Record<string, unknown> = {};
  if (firstName !== undefined) data.firstName = firstName;
  if (lastName !== undefined) data.lastName = lastName;
  if (email !== undefined) data.email = email.toLowerCase();
  if (phone !== undefined) data.phone = phone || null;
  if (mobile !== undefined) data.mobile = mobile || null;
  if (role !== undefined) data.role = role;
  if (tier !== undefined) data.tier = tier;
  if (assignedAgentId !== undefined) data.assignedAgentId = assignedAgentId || null;
  if (notes !== undefined) data.notes = notes;

  const person = await prisma.person.update({ where: { id }, data });
  return NextResponse.json(person);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  // Delete affiliations first
  await prisma.affiliation.deleteMany({ where: { personId: id } });
  await prisma.activity.deleteMany({ where: { personId: id } });
  await prisma.person.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
