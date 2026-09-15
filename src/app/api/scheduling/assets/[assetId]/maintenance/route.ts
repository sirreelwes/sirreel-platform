import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { NA_REFERRAL_TITLE, NA_FLEET_TITLE } from "@/lib/scheduling/naTitles";
import { parseNaEndDate } from "@/lib/scheduling/naDuration";
import { pacificYmd } from "@/lib/fleet/checkWindow";

type Params = { params: Promise<{ assetId: string }> };

const OPEN_STATUSES = ["SCHEDULED", "IN_PROGRESS"] as const;
// @db.Date columns hold UTC midnight of the day. "Today" is the PACIFIC day:
// the UTC day rolls over at 5pm here, and a "1 day" N/A keyed on it would
// start tomorrow and end before it began.
const dateOf = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/**
 * POST /api/scheduling/assets/[assetId]/maintenance — set/clear a unit's N/A
 * (out-of-service) state by opening/closing OPEN MaintenanceRecords (reuses the
 * existing model + the shipped N/A grey display; no schema change).
 *
 *   action: 'refer'   → SALES (canCreateBooking) opens a precautionary,
 *                       open-ended referral record (greys the unit immediately,
 *                       pending fleet triage).
 *
 * `note` (optional, <=280 chars) is what is actually WRONG with the unit —
 * "driver side mirror cracked", "check engine light on I-5". Stored as the
 * record's description; without it the record carried only boilerplate and
 * fleet had to phone whoever greyed the truck (Wes, 2026-08-24). The
 * boilerplate is retained as a prefix so provenance (who flagged it, sales
 * vs fleet) survives alongside the symptom.
 *   action: 'mark-na' → FLEET (canAssignAssets) opens a fleet-confirmed
 *                       out-of-service record.
 *   action: 'clear'   → FLEET (canAssignAssets) closes the unit's OPEN records
 *                       (status COMPLETED + endDate today) — NON-destructive,
 *                       maintenance history is preserved.
 *   action: 'set-return' → change the last day out on the unit's in-effect
 *                       records (the one-day fix that turned into three).
 *                       Fleet may move any; sales only its own referrals, so
 *                       a sales edit can never shorten a fleet N/A into a
 *                       bookable truck.
 *
 * `endDate` (YYYY-MM-DD, optional) on refer / mark-na / set-return is the
 * LAST day the unit is out, inclusive — "1 day" from the prompt is today.
 * Omitted/null = open-ended, until fleet clears it (the only shape before
 * 2026-09-15). Availability and the timeline already overlap-test endDate,
 * so a dated record releases the unit the day after with nobody clicking
 * Clear.
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
  // Trimmed and capped — this is a one-line symptom, not a work order.
  const note =
    body && typeof body.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 280)
      : null;
  if (action !== "refer" && action !== "mark-na" && action !== "clear" && action !== "set-return") {
    return NextResponse.json({ error: "action must be refer | mark-na | clear | set-return" }, { status: 400 });
  }

  const today = pacificYmd();
  const end = parseNaEndDate(body?.endDate, today);
  if (!end.ok) {
    return NextResponse.json({ error: end.error }, { status: 400 });
  }

  // Per-action permission: referral is a sales action; mark-NA / clear are
  // fleet. Changing the return date is either — scoped below for sales.
  const isFleet = can(actor.role, "canAssignAssets");
  const allowed =
    action === "refer"
      ? can(actor.role, "canCreateBooking")
      : action === "set-return"
        ? isFleet || can(actor.role, "canCreateBooking")
        : isFleet;
  if (!allowed) {
    return NextResponse.json(
      {
        error: "forbidden",
        reason:
          action === "refer"
            ? "referring a unit to maintenance is a sales action"
            : action === "set-return"
              ? "changing a unit's return date needs sales or fleet access"
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
    // Close everything open. Only records still running past today get
    // their end pulled in to today — a dated record that already lapsed
    // keeps its real last day rather than being stretched to now.
    const [pulledIn, lapsed] = await prisma.$transaction([
      prisma.maintenanceRecord.updateMany({
        where: {
          assetId,
          status: { in: [...OPEN_STATUSES] },
          OR: [{ endDate: null }, { endDate: { gt: dateOf(today) } }],
        },
        data: { status: "COMPLETED", endDate: dateOf(today) },
      }),
      prisma.maintenanceRecord.updateMany({
        where: { assetId, status: { in: [...OPEN_STATUSES] } },
        data: { status: "COMPLETED" },
      }),
    ]);
    return NextResponse.json({ ok: true, action, closed: pulledIn.count + lapsed.count });
  }

  if (action === "set-return") {
    const res = await prisma.maintenanceRecord.updateMany({
      where: {
        assetId,
        status: { in: [...OPEN_STATUSES] },
        OR: [{ endDate: null }, { endDate: { gte: dateOf(today) } }],
        ...(isFleet ? {} : { title: NA_REFERRAL_TITLE }),
      },
      data: { endDate: end.endYmd ? dateOf(end.endYmd) : null },
    });
    if (res.count === 0) {
      return NextResponse.json(
        {
          error: "nothing to change",
          reason: isFleet
            ? "this unit has no N/A in effect"
            : "only fleet can change the return date on a fleet N/A",
        },
        { status: isFleet ? 404 : 403 },
      );
    }
    return NextResponse.json({ ok: true, action, updated: res.count, endDate: end.endYmd });
  }

  // refer / mark-na → open an open-ended N/A record.
  const isReferral = action === "refer";
  const record = await prisma.maintenanceRecord.create({
    data: {
      assetId,
      unitName: asset.unitName,
      type: "OTHER",
      title: isReferral ? NA_REFERRAL_TITLE : NA_FLEET_TITLE,
      description: [
        isReferral
          ? "Flagged by sales as needing maintenance review. Greys the unit pending fleet triage."
          : "Marked out of service by fleet.",
        note,
      ]
        .filter(Boolean)
        .join(" — "),
      startDate: dateOf(today),
      endDate: end.endYmd ? dateOf(end.endYmd) : null,
      status: isReferral ? "SCHEDULED" : "IN_PROGRESS",
      createdBy: actor.id,
    },
    select: { id: true, status: true, description: true },
  });
  return NextResponse.json({
    ok: true,
    action,
    recordId: record.id,
    description: record.description,
    endDate: end.endYmd,
  });
}
