import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import {
  getCategoryAvailability,
  computeUnitStates,
  ACTIVE_ASSIGNMENT_STATUSES,
  LIVE_ITEM_STATUSES,
} from "@/lib/scheduling/availability";
import {
  planBookingDateFollow,
  applyBookingDateFollow,
} from "@/lib/scheduling/followBookingDates";

type Params = { params: Promise<{ id: string }> };

function parseDate(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * POST /api/scheduling/bookings/[id]/dates — a SALES user reschedules a
 * booking's start/end from the gantt bar. Gated + owned exactly like the status
 * route (canCreateBooking; agents only their own booking, ADMIN any).
 *
 * Reuses creation's validation primitives (getCategoryAvailability +
 * computeUnitStates) against the NEW window — NO parallel logic:
 *   - assigned items: re-check each bound asset for a hard overlap / buffer
 *     encroachment in the new window, EXCLUDING this booking's own assignments
 *     (so a reschedule never self-collides).
 *   - unassigned category holds: re-check category capacity, excluding this
 *     item's own pending demand.
 * Only LIVE primary (holdRank 1) items gate. Backups are allowed to overlap,
 * mirroring holds/route.ts, and DEAD lines (UNFULFILLED / SUBSTITUTED) are
 * skipped entirely — a released line holds no unit and demands none, so
 * re-validating it as category demand permanently froze the reservation's
 * dates (Wes 2026-09-14: SR-JOB-0340 couldn't move Cam 1 off 9/15 because a
 * released second Camera Cube line re-asked for capacity that was already
 * spoken for). Buffer encroachment returns 409 needsOverride (same as
 * creation); over-capacity / hard overlap is a hard 409. On success the
 * booking window + its active assignments (which are date COPIES, not derived)
 * are shifted together, and THE ORDER FOLLOWS (Wes 2026-09-18: "you should
 * be able to edit the dates of the reservation and have it adjust the order
 * and vice versa"). Until then this route moved the board and left the order
 * on the old week — the quote, the pick list and the agreement's rental
 * period all still read the days the rep had just moved off.
 * lib/scheduling/followBookingDates plans both halves: which units move
 * (a unit stamped for a line goes where its LINE goes — the through line —
 * so a two-block order stops being smashed onto one envelope) and which
 * order lines move with them. Closed-out orders are never re-dated; a
 * translation changes no money, a resize re-prices what it moves.
 * Status/backups untouched.
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
      { error: "forbidden", reason: "rescheduling a reservation is a sales action" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const start = parseDate(body?.startDate);
  const end = parseDate(body?.endDate);
  if (!start || !end) {
    return NextResponse.json({ error: "startDate and endDate (YYYY-MM-DD) are required" }, { status: 400 });
  }
  if (end < start) {
    return NextResponse.json({ error: "endDate must be on or after startDate" }, { status: 400 });
  }
  const bufferDays = Number.isFinite(body?.bufferDays) ? Number(body.bufferDays) : 1;
  const bufferOverride = !!body?.bufferOverride;

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      agentId: true,
      startDate: true,
      endDate: true,
      items: {
        select: {
          id: true,
          categoryId: true,
          quantity: true,
          holdRank: true,
          status: true,
          assignments: {
            where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
            select: { id: true, asset: { select: { id: true, unitName: true, tier: true } } },
          },
        },
      },
    },
  });
  if (!booking) {
    return NextResponse.json({ error: "booking not found" }, { status: 404 });
  }
  // No ownership check (Wes 2026-08-21): reservation moves are shared
  // coverage work - anyone with canCreateBooking may reschedule any
  // booking, not just their own. (The old own-bookings-only rule also
  // never matched in practice: bookings.agent_id is a CRM Person id,
  // not the session User id.)

  // Every active assignment this booking owns — excluded from its own conflict
  // re-check so the reschedule doesn't collide with itself.
  const ownAssignmentIds = booking.items.flatMap((it) => it.assignments.map((a) => a.id));
  const lookaround = Math.max(1, bufferDays + 1);
  const queryStart = new Date(start.getTime() - lookaround * 86_400_000);
  const queryEnd = new Date(end.getTime() + lookaround * 86_400_000);

  const liveStatuses = new Set<string>(LIVE_ITEM_STATUSES);
  for (const it of booking.items) {
    // Dead line (released / substituted) — holds nothing, demands nothing.
    // Everything else that reads a booking's items already skips these; this
    // loop didn't, so one released line blocked every reschedule of the whole
    // reservation with a capacity error about gear nobody is still asking for.
    if (!liveStatuses.has(it.status)) continue;
    const isPrimary = (it.holdRank ?? 1) < 2;
    if (!isPrimary) continue; // backups may overlap — mirror creation

    if (it.assignments.length > 0) {
      // Assigned → re-check each bound asset in the new window (per-asset,
      // excluding this booking's own assignments) via computeUnitStates.
      for (const asn of it.assignments) {
        const asset = asn.asset;
        const others = await prisma.bookingAssignment.findMany({
          where: {
            assetId: asset.id,
            status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
            startDate: { lte: queryEnd },
            endDate: { gte: queryStart },
            id: { notIn: ownAssignmentIds },
          },
          select: { assetId: true, startDate: true, endDate: true },
        });
        const state =
          computeUnitStates(
            [{ id: asset.id, unitName: asset.unitName, tier: asset.tier }],
            others,
            start,
            end,
            bufferDays,
          )[0]?.state ?? "free";
        if (state === "booked") {
          return NextResponse.json(
            {
              ok: false,
              error: "over-capacity",
              reason: `Unit ${asset.unitName} is already booked in the new window (${ymd(start)} – ${ymd(end)}).`,
            },
            { status: 409 },
          );
        }
        if (state === "buffer" && !bufferOverride) {
          return NextResponse.json(
            {
              ok: false,
              error: "buffer-encroachment",
              needsOverride: true,
              reason: `Unit ${asset.unitName} would sit inside the buffer window of another booking. Resubmit with bufferOverride to proceed.`,
            },
            { status: 409 },
          );
        }
      }
    } else {
      // Unassigned category hold → category capacity in the new window,
      // excluding this item's own pending demand.
      const avail = await getCategoryAvailability(it.categoryId, start, end, bufferDays, it.id);
      const catName = avail.category?.name ?? "category";
      if (it.quantity > avail.availableToHold) {
        return NextResponse.json(
          {
            ok: false,
            error: "over-capacity",
            reason: `${catName}: ${it.quantity} requested but only ${avail.availableToHold} available to hold in the new window (${ymd(start)} – ${ymd(end)}).`,
          },
          { status: 409 },
        );
      }
      if (it.quantity > avail.freeCount && !bufferOverride) {
        return NextResponse.json(
          {
            ok: false,
            error: "buffer-encroachment",
            needsOverride: true,
            reason: `${catName}: ${it.quantity} requested but only ${avail.freeCount} fully-free unit(s) in the new window; the rest would draw on buffer. Resubmit with bufferOverride to proceed.`,
          },
          { status: 409 },
        );
      }
    }
  }

  // What moves with it: every unit on the reservation, and every line of
  // every live order it belongs to. Planned BEFORE the write, off the
  // window the booking still has.
  const from = { start: booking.startDate, end: booking.endDate };
  const to = { start, end };
  const plan = await planBookingDateFollow({ bookingId: id, from, to });

  // All clear — shift the booking window AND its active assignments
  // together (assignment dates are copies stamped at assign time, not
  // derived). Each unit takes ITS OWN new window, not the envelope: a
  // blanket stamp collapsed the second leg of a two-block reservation
  // onto one set of days.
  await prisma.$transaction([
    prisma.booking.update({ where: { id }, data: { startDate: start, endDate: end } }),
    ...plan.assignmentMoves.map((mv) =>
      prisma.bookingAssignment.update({
        where: { id: mv.id },
        data: { startDate: mv.start, endDate: mv.end },
      }),
    ),
  ]);

  // The order side. Non-fatal by contract — the reservation has already
  // moved, so a failure here is reported, never thrown.
  const followed = await applyBookingDateFollow({
    plan,
    actor: { userId: actor.id, ipAddress: req.headers.get("x-forwarded-for") },
  });
  if (followed.error) console.error("[bookings/dates] the order did not follow:", followed.error);

  return NextResponse.json({
    ok: true,
    startDate: ymd(start),
    endDate: ymd(end),
    bufferOverrideUsed: bufferOverride,
    unitsMoved: plan.assignmentMoves.length,
    ordersFollowed: followed,
  });
}
