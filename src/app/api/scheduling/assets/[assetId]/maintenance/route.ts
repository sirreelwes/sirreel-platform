import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

type Params = { params: Promise<{ assetId: string }> };

// Title tags let the gantt N/A display distinguish a sales referral (pending
// fleet review) from a fleet-confirmed out-of-service record — no schema field.
// Keep in lockstep with the /referral|pending fleet review/i test in
// timeline-native's naByAsset classifier.
export const NA_REFERRAL_TITLE = "Unit N/A — sales referral (pending fleet review)";
export const NA_FLEET_TITLE = "Unit N/A — out of service (fleet)";

const OPEN_STATUSES = ["SCHEDULED", "IN_PROGRESS"] as const;
// UTC-midnight "today" for the @db.Date columns.
const todayDate = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

/**
 * POST /api/scheduling/assets/[assetId]/maintenance — set/clear a unit's N/A
 * (out-of-service) state by opening/closing OPEN MaintenanceRecords (reuses the
 * existing model + the shipped N/A grey display; no schema change).
 *
 *   action: 'refer'   → SALES (canCreateBooking) opens a precautionary,
 *                       open-ended referral record (greys the unit immediately,
 *                       pending fleet triage).
 *   action: 'mark-na' → FLEET (canAssignAssets) opens a fleet-confirmed
 *                       out-of-service record.
 *   action: 'clear'   → FLEET (canAssignAssets) closes the unit's OPEN records
 *                       (status COMPLETED + endDate today) — NON-destructive,
 *                       maintenance history is preserved.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { assetId } = await params;

  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  });
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const action = body && typeof body.action === "string" ? body.action : "";
  if (action !== "refer" && action !== "mark-na" && action !== "clear") {
    return NextResponse.json({ error: "action must be refer | mark-na | clear" }, { status: 400 });
  }

  // Per-action permission: referral is a sales action; mark-NA / clear are fleet.
  const needed = action === "refer" ? "canCreateBooking" : "canAssignAssets";
  if (!can(actor.role, needed)) {
    return NextResponse.json(
      {
        error: "forbidden",
        reason:
          action === "refer"
            ? "referring a unit to maintenance is a sales action"
            : "marking a unit out of service is a fleet action",
      },
      { status: 403 },
    );
  }

  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, unitName: true } });
  if (!asset) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }

  if (action === "clear") {
    const res = await prisma.maintenanceRecord.updateMany({
      where: { assetId, status: { in: [...OPEN_STATUSES] } },
      data: { status: "COMPLETED", endDate: todayDate() },
    });
    return NextResponse.json({ ok: true, action, closed: res.count });
  }

  // refer / mark-na → open an open-ended N/A record.
  const isReferral = action === "refer";
  const record = await prisma.maintenanceRecord.create({
    data: {
      assetId,
      unitName: asset.unitName,
      type: "OTHER",
      title: isReferral ? NA_REFERRAL_TITLE : NA_FLEET_TITLE,
      description: isReferral
        ? "Flagged by sales as needing maintenance review. Greys the unit pending fleet triage."
        : "Marked out of service by fleet.",
      startDate: todayDate(),
      endDate: null,
      status: isReferral ? "SCHEDULED" : "IN_PROGRESS",
      createdBy: actor.id,
    },
    select: { id: true, status: true },
  });
  return NextResponse.json({ ok: true, action, recordId: record.id });
}
