import { NextRequest, NextResponse } from "next/server";
import type { TaskType, Location } from "@prisma/client";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

// The SirReel depot end of a delivery/pickup. fromLocation is the Location
// enum (yards), so it holds the depot only when the depot is the ORIGIN
// (deliveries). For pickups the depot is the DESTINATION and the client site
// is the origin — fromLocation can't hold a client street address, so the
// client end always lives in the free-text siteAddress and the depot goes in
// toLocation (also free text) for pickups.
const DEPOT_ENUM: Location = "LANKERSHIM";
const DEPOT_LABEL = "Lankershim";

/**
 * POST /api/orders/[id]/dispatch-tasks — SALES creates a delivery or pickup
 * task (STEP 3). Lands PENDING/unassigned; fleet assigns driver + tow vehicle
 * later (STEP 4). Gated on canCreateBooking (the sales-origination perm) — the
 * same gate as the order's delivery/pickup marking.
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

  // This form only creates DELIVERY / PICKUP (not the other TaskType values).
  if (type !== "DELIVERY" && type !== "PICKUP") {
    return NextResponse.json({ error: "type must be DELIVERY or PICKUP" }, { status: 400 });
  }
  if (typeof scheduledDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return NextResponse.json({ error: "scheduledDate (YYYY-MM-DD) is required" }, { status: 400 });
  }
  const site = typeof siteAddress === "string" ? siteAddress.trim() : "";
  if (!site) {
    return NextResponse.json({ error: "siteAddress (the client site) is required" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, bookingId: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  // Yard end: deliveries leave FROM the depot (fromLocation enum); pickups
  // return TO the depot (toLocation free text). The client site is always
  // siteAddress. Direction is carried by `type`.
  const fromLocation: Location | null = type === "DELIVERY" ? DEPOT_ENUM : null;
  const toLocation: string | null = type === "PICKUP" ? DEPOT_LABEL : null;

  const task = await prisma.dispatchTask.create({
    data: {
      orderId: order.id,
      bookingId: order.bookingId ?? null,
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
      // assignedTo (driver) + towVehicle are deliberately left empty — fleet
      // fills those when they assign the task (STEP 4).
    },
    select: { id: true, type: true, status: true, scheduledDate: true },
  });

  return NextResponse.json({ ok: true, task });
}
