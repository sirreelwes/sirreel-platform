import { NextResponse } from "next/server";
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
