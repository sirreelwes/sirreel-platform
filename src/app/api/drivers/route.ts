import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/drivers — active drivers for the delivery/pickup task-assign
 * picker. Session-gated read (any dashboard user); assignment itself is
 * canAssignAssets-gated on the assign endpoint.
 */
export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true, type: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  return NextResponse.json({
    drivers: drivers.map((d) => ({
      id: d.id,
      name: `${d.firstName} ${d.lastName}`.trim(),
      type: d.type,
    })),
  });
}

/**
 * POST /api/drivers — create a driver record. Staff-only. Deliberately
 * minimal: a name is enough to start a file, because the common case is
 * a production calling ahead with "Marco is picking up Tuesday" and the
 * licence arriving later through the driver portal.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const firstName = String(body?.firstName ?? "").trim();
  const lastName = String(body?.lastName ?? "").trim();
  if (!firstName || !lastName) {
    return NextResponse.json({ error: "firstName and lastName are required" }, { status: 400 });
  }
  const driver = await prisma.driver.create({
    data: {
      firstName,
      lastName,
      phone: body?.phone ? String(body.phone).trim().slice(0, 30) : null,
      email: body?.email ? String(body.email).trim() : null,
      type: body?.type === "INTERNAL" ? "INTERNAL" : "EXTERNAL",
      companyId: body?.companyId ? String(body.companyId) : null,
      notes: body?.notes ? String(body.notes) : null,
    },
    select: { id: true, firstName: true, lastName: true, type: true },
  });
  return NextResponse.json({ ok: true, driver });
}
