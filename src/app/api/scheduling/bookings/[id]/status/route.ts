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
  // No ownership check (Wes 2026-08-21): status changes are shared
  // coverage work for anyone with canCreateBooking - see dates route.

  // CANCELLED must release what the booking holds, in the same
  // transaction as the flip. Without this, the cancelled booking's
  // BookingAssignments stayed ASSIGNED and its items stayed REQUESTED —
  // so the units kept counting as booked and the pending demand kept
  // consuming availableToHold. A cancelled reservation permanently
  // blocked the calendar until someone found and released each item by
  // hand. (Planyo releases inventory on cancel; post-cutover this is
  // the only cancel path, so it has to do the same.)
  //
  // Mirrors booking-items/[id]/release exactly: items REQUESTED/ASSIGNED
  // → UNFULFILLED; their ACTIVE assignments → SWAPPED (terminal-but-
  // auditable — rows stay for history). Terminal item states are left
  // untouched. Backups on the same window belong to OTHER bookings and
  // are not affected by cancelling this one.
  let driversReleased = 0;
  const updated = await prisma.$transaction(async (tx) => {
    if (target === "CANCELLED") {
      const items = await tx.bookingItem.findMany({
        where: { bookingId: id, status: { in: ["REQUESTED", "ASSIGNED"] } },
        select: { id: true },
      });
      if (items.length) {
        const itemIds = items.map((i) => i.id);
        await tx.bookingAssignment.updateMany({
          where: {
            bookingItemId: { in: itemIds },
            status: { in: ["ASSIGNED", "CHECKED_OUT"] },
          },
          data: { status: "SWAPPED" },
        });
        await tx.bookingItem.updateMany({
          where: { id: { in: itemIds } },
          data: { status: "UNFULFILLED" },
        });
      }

      // Drivers named for this booking lose their access with it.
      //
      // DriverAssignment.token is the driver's no-login credential for the
      // job page AND the gate code. Releasing the units without expiring
      // those tokens left people able to walk up to the yard for a booking
      // that no longer exists — and invisible while doing it, because the
      // staff job page filters cancelled bookings out entirely, so the
      // driver appeared on nobody's screen. (Wes 2026-08-26.)
      //
      // PICKED_UP is left alone on purpose, the same rule both DELETE
      // endpoints follow: those keys are already out and CheckoutRecord is
      // the authoritative record of who took them. Cancelling a booking
      // after collection is a paperwork correction, not a recall.
      const releasedDrivers = await tx.driverAssignment.updateMany({
        where: {
          bookingAssignment: { bookingItem: { bookingId: id } },
          status: { notIn: ["CANCELLED", "PICKED_UP"] },
        },
        data: { status: "CANCELLED", expiresAt: new Date() },
      });
      driversReleased = releasedDrivers.count;
    }
    return tx.booking.update({
      where: { id },
      // Mirror the confirm route's confirmedAt stamp when moving to CONFIRMED.
      data: target === "CONFIRMED" ? { status: target, confirmedAt: new Date() } : { status: target },
      select: { id: true, status: true },
    });
  });
  // Surfaced so the caller can say "3 drivers lost access" rather than the
  // change happening silently.
  return NextResponse.json({ ok: true, status: updated.status, driversReleased });
}
