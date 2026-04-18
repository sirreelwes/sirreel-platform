import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const { completed } = body;

  const data: Record<string, unknown> = {};
  if (completed !== undefined) {
    data.completed = completed;
    data.completedAt = completed ? new Date() : null;
  }

  const activity = await prisma.activity.update({ where: { id }, data });
  return NextResponse.json(activity);
}
