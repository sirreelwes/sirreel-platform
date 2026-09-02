import { NextRequest, NextResponse } from "next/server";
import type { LineItemDepartment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { recalcOrderTotals } from "@/lib/orders";
import { computeLineTotal } from "@/lib/orders/billing";
import { auditLineItemEdit, extractIp, resolveOperatorId } from "@/lib/orders/auditLineItemEdit";
import { isLineItemEditable, lineEditLockReason } from "@/lib/orders/editability";
import { syncOrderWindowSafe } from '@/lib/orders/syncOrderWindow'

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH — set billable days across every line in ONE department.
 *
 * Why this exists: billable days are a per-line column, but they're a
 * per-department DECISION — "Pro Supplies bills 3 of the 5 calendar
 * days" is one call the rep makes about seventeen rows. With only the
 * row editor, re-deciding that meant seventeen edits, and one missed
 * row (a Utility Fan left at 1 while its seventeen neighbours read 3)
 * is invisible in a long list and quietly under-bills the order.
 *
 * Deliberately days-ONLY. Days don't move quantity, department,
 * category or rate, so none of the PUT route's heavy sync paths apply:
 * holds feasibility is a function of qty × category (delta zero here),
 * pick-list membership keys off department, and kit-piece quantities
 * derive from the parent's qty. That's what makes a bulk write safe to
 * do here rather than by looping the full single-line PUT — anything
 * beyond days should go through that route, one line at a time.
 *
 * Scope: lines whose department matches, PLUS their kit-piece children
 * (which is exactly the set the order page renders under that band —
 * an accessory that bills a different number of days than the item it
 * came attached to is never what anyone meant).
 *
 * FLAT lines are skipped: computeLineTotal ignores days for them, so
 * writing one would churn the audit trail to no effect. EXPENDABLES
 * (PURCHASE model) are likewise day-less — the whole department is
 * rejected rather than silently no-op'd.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: orderId } = await params;

  try {
    const { department, days } = (await req.json()) as {
      department?: LineItemDepartment;
      days?: unknown;
    };

    if (!department) {
      return NextResponse.json(
        { error: "department required", reason: "No department given." },
        { status: 400 },
      );
    }
    if (department === "EXPENDABLES") {
      return NextResponse.json(
        {
          error: "department has no day concept",
          reason: "Expendables are billed as a purchase (qty × rate) — they have no billable days.",
        },
        { status: 400 },
      );
    }
    const parsedDays = Math.floor(Number(days));
    if (!Number.isFinite(parsedDays) || parsedDays < 1) {
      return NextResponse.json(
        { error: "invalid days", reason: "Days must be a whole number of 1 or more." },
        { status: 400 },
      );
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!order) {
      return NextResponse.json({ error: "order not found" }, { status: 404 });
    }
    if (!isLineItemEditable(order.status, department)) {
      return NextResponse.json(
        {
          error: "line edit not permitted",
          reason:
            lineEditLockReason(order.status, department) ??
            "edit not permitted in current order state",
          orderStatus: order.status,
          department,
        },
        { status: 409 },
      );
    }

    const deptLines = await prisma.orderLineItem.findMany({
      where: { orderId, department },
      select: {
        id: true, quantity: true, rate: true, rateType: true,
        department: true, billableDays: true, lineTotal: true, description: true,
      },
    });
    // Kit pieces / ancillaries hanging off those lines follow their parent.
    const children = deptLines.length
      ? await prisma.orderLineItem.findMany({
          where: { orderId, parentLineItemId: { in: deptLines.map((l) => l.id) } },
          select: {
            id: true, quantity: true, rate: true, rateType: true,
            department: true, billableDays: true, lineTotal: true, description: true,
          },
        })
      : [];

    const byId = new Map([...deptLines, ...children].map((l) => [l.id, l]));
    const targets = [...byId.values()].filter(
      (l) => l.rateType !== "FLAT" && l.department !== "EXPENDABLES" && l.billableDays !== parsedDays,
    );

    if (targets.length === 0) {
      return NextResponse.json({ updated: 0, days: parsedDays, department, lines: [] });
    }

    const updates = targets.map((l) => ({
      id: l.id,
      description: l.description,
      before: { billableDays: l.billableDays, lineTotal: Number(l.lineTotal) },
      after: {
        billableDays: parsedDays,
        lineTotal:
          Math.round(
            computeLineTotal({
              quantity: l.quantity,
              rate: l.rate,
              billableDays: parsedDays,
              rateType: l.rateType,
              department: l.department,
            }) * 100,
          ) / 100,
      },
    }));

    await prisma.$transaction(
      updates.map((u) =>
        prisma.orderLineItem.update({
          where: { id: u.id },
          data: { billableDays: u.after.billableDays, lineTotal: u.after.lineTotal },
        }),
      ),
    );

    await recalcOrderTotals(orderId);

    // One audit row for the whole sweep, carrying every touched line id
    // and its prior value — reversible by captured id, per the hard rule.
    await auditLineItemEdit({
      orderId,
      orderStatus: order.status,
      action: "order.line_item_updated",
      oldValues: {
        bulkDays: { department, lines: updates.map((u) => ({ id: u.id, ...u.before })) },
      },
      newValues: {
        bulkDays: { department, days: parsedDays, lines: updates.map((u) => ({ id: u.id, ...u.after })) },
      },
      userId: await resolveOperatorId(session.user.email),
      ipAddress: extractIp(req),
    });

    await syncOrderWindowSafe(orderId);
    return NextResponse.json({
      updated: updates.length,
      days: parsedDays,
      department,
      lines: updates.map((u) => ({ id: u.id, description: u.description, ...u.after })),
    });
  } catch (err) {
    console.error("[orders] bulk-days failed:", err);
    return NextResponse.json(
      { error: "bulk day update failed", reason: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
