import { NextRequest, NextResponse } from "next/server";
import type { BookingStatus } from "@prisma/client";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

// Sales-facing manual status set from the gantt bar. Display token → enum.
// Round-trips through timeline-native's mapStatus (REQUEST→inquiry,
// PENDING_APPROVAL→hold, CONFIRMED→booked, CANCELLED→cancelled).
const DISPLAY_TO_STATUS: Record<string, BookingStatus> = {
  inquiry: "REQUEST",
  hold: "PENDING_APPROVAL",
  booked: "CONFIRMED",
  cancelled: "CANCELLED",
};

/**
 * POST /api/scheduling/bookings/[id]/status — a SALES user sets a reservation's
 * status among Inquiry / Hold / Booked / Cancelled from the gantt bar. Gated on
 * canCreateBooking (AGENT + ADMIN) — intentionally wider than the ADMIN-only
 * canConfirmBooking ("agents book on strong likelihood"). Agents may only touch
 * their OWN bookings; ADMIN may touch any.
 *
 * Booked (CONFIRMED) requires NO rental agreement and triggers NO agreement /
 * email side effects — those are tied to Order/portal flows, never the Booking
 * status enum. This is a plain, side-effect-free status flip.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  });
  if (!actor || !can(actor.role, "canCreateBooking")) {
    return NextResponse.json(
      { error: "forbidden", reason: "changing reservation status is a sales action" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const display = body && typeof body.status === "string" ? body.status : "";
  const target = DISPLAY_TO_STATUS[display];
  if (!target) {
    return NextResponse.json(
      { error: "status must be one of inquiry | hold | booked | cancelled" },
      { status: 400 },
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, agentId: true },
  });
  if (!booking) {
    return NextResponse.json({ error: "booking not found" }, { status: 404 });
  }
  // Ownership: agents change only their own reservations; ADMIN changes any.
  if (actor.role !== "ADMIN" && booking.agentId !== actor.id) {
    return NextResponse.json(
      { error: "forbidden", reason: "you can only change status on your own reservations" },
      { status: 403 },
    );
  }

  const updated = await prisma.booking.update({
    where: { id },
    // Mirror the confirm route's confirmedAt stamp when moving to CONFIRMED.
    data: target === "CONFIRMED" ? { status: target, confirmedAt: new Date() } : { status: target },
    select: { id: true, status: true },
  });
  return NextResponse.json({ ok: true, status: updated.status });
}
