import { NextRequest, NextResponse } from "next/server";
import type { TaskType, Location } from "@prisma/client";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

// SirReel depot end (mirrors /api/orders/[id]/dispatch-tasks). Client end lives
// in siteAddress; direction is carried by `type`.
const DEPOT_ENUM: Location = "LANKERSHIM";
const DEPOT_LABEL = "Lankershim";

/**
 * POST /api/scheduling/dispatch-tasks — STANDALONE delivery/pickup task create
 * (no order). Same body contract + sales gate as the order-scoped
 * /api/orders/[id]/dispatch-tasks, but orderId/bookingId are null. Lands
 * PENDING/unassigned and surfaces in the gantt needs-assignment lane by date;
 * fleet assigns driver + tow vehicle later. Used by the "+ New → New Task"
 * shell menu.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  });
  if (!actor || !can(actor.role, "canCreateBooking")) {
    return NextResponse.json(
      { error: "forbidden", reason: "creating a delivery/pickup task is a sales action" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }
  const {
    type, scheduledDate, scheduledTime, siteAddress, contactName, contactPhone,
    deliveryItems, notes,
  } = body as Record<string, unknown>;

  if (type !== "DELIVERY" && type !== "PICKUP") {
    return NextResponse.json({ error: "type must be DELIVERY or PICKUP" }, { status: 400 });
  }
  if (typeof scheduledDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return NextResponse.json({ error: "scheduledDate (YYYY-MM-DD) is required" }, { status: 400 });
  }
  const site = typeof siteAddress === "string" ? siteAddress.trim() : "";
  if (!site) {
    return NextResponse.json({ error: "siteAddress (the site) is required" }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const fromLocation: Location | null = type === "DELIVERY" ? DEPOT_ENUM : null;
  const toLocation: string | null = type === "PICKUP" ? DEPOT_LABEL : null;

  const task = await prisma.dispatchTask.create({
    data: {
      orderId: null,
      bookingId: null,
      type: type as TaskType,
      status: "PENDING",
      scheduledDate: new Date(`${scheduledDate}T00:00:00`),
      scheduledTime: str(scheduledTime),
      siteAddress: site,
      contactName: str(contactName),
      contactPhone: str(contactPhone),
      deliveryItems: str(deliveryItems),
      notes: str(notes),
      fromLocation,
      toLocation,
      // assignedTo (driver) + towVehicle left empty — fleet fills those.
    },
    select: { id: true, type: true, status: true, scheduledDate: true },
  });

  return NextResponse.json({ ok: true, task });
}
