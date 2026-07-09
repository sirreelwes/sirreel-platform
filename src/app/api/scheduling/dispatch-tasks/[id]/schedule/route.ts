import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/scheduling/dispatch-tasks/[id]/schedule — move a delivery/pickup
 * task to a different day (drag-to-reschedule in the gantt top task lane).
 * Changes ONLY scheduledDate; driver / tow vehicle / site / contact are left
 * untouched. Fleet action (canAssignAssets) — mirrors the assign endpoint's
 * gate, since the task lane is fleet-interactive. Date is constructed exactly
 * like the create route so the gantt's day math stays stable.
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
  if (!actor || !can(actor.role, "canAssignAssets")) {
    return NextResponse.json(
      { error: "forbidden", reason: "rescheduling a delivery/pickup task is a fleet action" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const scheduledDate = body && typeof body.scheduledDate === "string" ? body.scheduledDate : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return NextResponse.json({ error: "scheduledDate (YYYY-MM-DD) is required" }, { status: 400 });
  }

  const task = await prisma.dispatchTask.findUnique({ where: { id }, select: { id: true } });
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  const updated = await prisma.dispatchTask.update({
    where: { id },
    data: { scheduledDate: new Date(`${scheduledDate}T00:00:00`) },
    select: { id: true, scheduledDate: true },
  });
  return NextResponse.json({ ok: true, task: updated });
}
