import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { evaluateLicenseGate } from "@/lib/drivers/licenseGate";
import { can } from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/scheduling/dispatch-tasks/[id]/assign — FLEET assigns a driver +
 * tow vehicle to a delivery/pickup task (STEP 4). Gated on canAssignAssets
 * (fleet) — the mark/create side is sales (canCreateBooking). Setting a tow
 * vehicle drops the task from the gantt needs-assignment lane.
 *
 * NOTE: intentionally does NOT use requireDispatchAccess — that guard's repoint
 * off the retiring `dispatch` perm is a separate step. This new endpoint gates
 * directly on canAssignAssets.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  });
  // SALES or FLEET (2026-07 re-split): task tow-vehicle + driver assignment is
  // shared between reservation control and fleet ops.
  if (!actor || !(can(actor.role, "canCreateBooking") || can(actor.role, "canAssignAssets"))) {
    return NextResponse.json(
      { error: "forbidden", reason: "assigning a delivery/pickup task is a sales or fleet action" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }
  const { assignedTo, towVehicle } = body as Record<string, unknown>;

  // Tow vehicle is required — it's the field that clears the task from the
  // needs-assignment lane. Driver is optional (may be assigned separately).
  const tow = typeof towVehicle === "string" ? towVehicle.trim() : "";
  if (!tow) {
    return NextResponse.json({ error: "towVehicle is required" }, { status: 400 });
  }
  const driverId = typeof assignedTo === "string" && assignedTo.trim() ? assignedTo.trim() : null;

  const task = await prisma.dispatchTask.findUnique({ where: { id }, select: { id: true } });
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  // Licence state travels with the response but does NOT block here.
  // Dispatch assignment is planning, often days ahead of the vehicle
  // moving; the hard gate lives at physical handover
  // (POST /api/fleet/checkouts/[id]/driver). Blocking the plan would just
  // push dispatch to assign a placeholder driver and fix it later, which
  // hides the problem instead of surfacing it. The UI shows this as a
  // warning so the licence gets sorted before pickup day.
  let licenseGate: ReturnType<typeof evaluateLicenseGate> | null = null;
  if (driverId) {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true, licenseFrontUrl: true, licenseBackUrl: true,
        licenseExpiry: true, licenseExpired: true, licenseVerified: true,
      },
    });
    if (!driver) {
      return NextResponse.json({ error: "driver not found" }, { status: 400 });
    }
    licenseGate = evaluateLicenseGate(driver);
  }

  const updated = await prisma.dispatchTask.update({
    where: { id },
    data: { towVehicle: tow, assignedTo: driverId },
    select: { id: true, towVehicle: true, assignedTo: true, status: true },
  });
  return NextResponse.json({ ok: true, task: updated, licenseGate });
}
