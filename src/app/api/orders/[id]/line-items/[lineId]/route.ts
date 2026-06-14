import { NextRequest, NextResponse } from "next/server";
import type { LineItemDepartment, RateType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { recalcOrderTotals, rentalDays as computeRentalDays } from "@/lib/orders";
import { computeLineTotal } from "@/lib/orders/billing";
import { auditLineItemEdit, extractIp, resolveOperatorId } from "@/lib/orders/auditLineItemEdit";

type Params = { params: Promise<{ id: string; lineId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: orderId, lineId } = await params;

  try {
    const body = await req.json();
    const {
      type, description, inventoryItemId, assetCategoryId,
      startDate, endDate, rateType, rate, quantity, sortOrder, notes,
      days: manualDays, billableDays, rentalDays: legacyRentalDays,
      department, qualifier, pickupDate, returnDate,
    } = body;

    const data: Record<string, unknown> = {};
    if (type !== undefined) data.type = type;
    if (description !== undefined) data.description = description;
    if (inventoryItemId !== undefined) data.inventoryItemId = inventoryItemId || null;
    if (assetCategoryId !== undefined) data.assetCategoryId = assetCategoryId || null;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (pickupDate !== undefined) data.pickupDate = pickupDate ? new Date(pickupDate) : undefined;
    if (returnDate !== undefined) data.returnDate = returnDate ? new Date(returnDate) : undefined;
    if (rateType !== undefined) data.rateType = rateType;
    if (rate !== undefined) data.rate = rate;
    if (quantity !== undefined) data.quantity = quantity;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (notes !== undefined) data.notes = notes || null;
    if (department !== undefined) data.department = department;
    if (qualifier !== undefined) data.qualifier = qualifier || null;

    // Accept billableDays going forward, plus legacy rentalDays / days for
    // back-compat with older callers.
    const explicitDays = billableDays ?? legacyRentalDays ?? manualDays;
    const dayInputProvided = explicitDays !== undefined && explicitDays !== null;
    if (
      rateType !== undefined || rate !== undefined || quantity !== undefined ||
      startDate !== undefined || endDate !== undefined || pickupDate !== undefined ||
      returnDate !== undefined || dayInputProvided ||
      department !== undefined || inventoryItemId !== undefined || assetCategoryId !== undefined
    ) {
      const existing = await prisma.orderLineItem.findUnique({ where: { id: lineId } });
      if (existing) {
        const effectiveRateType = (rateType ?? existing.rateType) as RateType;
        const effectiveRate = Number(rate ?? existing.rate);
        const effectiveQty = Number(quantity ?? existing.quantity);
        const effectiveDept = (department as LineItemDepartment | undefined) ?? existing.department;

        let effectiveDays = existing.billableDays;
        if (dayInputProvided) {
          effectiveDays = Math.max(1, Math.floor(Number(explicitDays)));
        } else if (pickupDate !== undefined || returnDate !== undefined) {
          const p = pickupDate !== undefined ? (pickupDate ? new Date(pickupDate) : existing.pickupDate) : existing.pickupDate;
          const r = returnDate !== undefined ? (returnDate ? new Date(returnDate) : existing.returnDate) : existing.returnDate;
          if (p && r) effectiveDays = computeRentalDays(p, r);
        }

        const lineTotal = computeLineTotal({
          quantity: effectiveQty,
          rate: effectiveRate,
          billableDays: effectiveDays,
          rateType: effectiveRateType,
          department: effectiveDept,
        });
        data.billableDays = effectiveDays;
        data.lineTotal = Math.round(lineTotal * 100) / 100;
      }
    }

    // (#5 AuditLog) Capture pre-update snapshot when the order is
    // post-APPROVED. Cheap read — only fires for committed-state
    // orders. For DRAFT/QUOTE_SENT the snapshot is skipped entirely.
    const parentOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    const preUpdate = parentOrder && parentOrder.status !== 'DRAFT' && parentOrder.status !== 'QUOTE_SENT' && parentOrder.status !== 'APPROVED'
      ? await prisma.orderLineItem.findUnique({ where: { id: lineId } })
      : null;

    const lineItem = await prisma.orderLineItem.update({
      where: { id: lineId },
      data,
      include: {
        inventoryItem: { select: { id: true, code: true, description: true } },
        assetCategory: { select: { id: true, name: true } },
      },
    });

    const totals = await recalcOrderTotals(orderId);

    if (parentOrder && preUpdate) {
      const operatorId = await resolveOperatorId(session.user.email);
      // Build a compact diff so the AuditLog row is grep-friendly
      // ("show me every line where rate changed last month"). Each
      // field is logged only when it actually changed.
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      const fields: Array<keyof typeof preUpdate> = [
        'description', 'department', 'quantity', 'rate',
        'billableDays', 'rateType', 'lineTotal',
        'inventoryItemId', 'assetCategoryId', 'qualifier',
        'pickupDate', 'returnDate',
      ];
      for (const f of fields) {
        const a = preUpdate[f];
        const b = (lineItem as unknown as Record<string, unknown>)[f as string];
        const aStr = a == null ? null : (typeof a === 'object' && 'toString' in (a as object)) ? (a as { toString: () => string }).toString() : a;
        const bStr = b == null ? null : (typeof b === 'object' && 'toString' in (b as object)) ? (b as { toString: () => string }).toString() : b;
        if (JSON.stringify(aStr) !== JSON.stringify(bStr)) {
          diff[f as string] = { from: aStr as unknown, to: bStr as unknown };
        }
      }
      await auditLineItemEdit({
        orderId,
        orderStatus: parentOrder.status,
        action: 'order.line_item_updated',
        oldValues: { lineItemId: lineId, ...diff },
        newValues: { lineItemId: lineId, changedFields: Object.keys(diff) },
        userId: operatorId,
        ipAddress: extractIp(req),
      });
    }

    return NextResponse.json({ lineItem, totals });
  } catch (error) {
    console.error("Update line item error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: orderId, lineId } = await params;

  // (#5 AuditLog) Snapshot the row + parent status BEFORE the
  // cascade-delete fires. Once `orderLineItem.delete` runs, the row
  // is gone and we can't reconstruct what was removed.
  const parentOrder = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  const preDelete = parentOrder && parentOrder.status !== 'DRAFT' && parentOrder.status !== 'QUOTE_SENT' && parentOrder.status !== 'APPROVED'
    ? await prisma.orderLineItem.findUnique({ where: { id: lineId } })
    : null;

  await prisma.orderLineItem.delete({ where: { id: lineId } });
  const totals = await recalcOrderTotals(orderId);

  if (parentOrder && preDelete) {
    const operatorId = await resolveOperatorId(session.user.email);
    await auditLineItemEdit({
      orderId,
      orderStatus: parentOrder.status,
      action: 'order.line_item_removed',
      oldValues: {
        lineItemId: lineId,
        description: preDelete.description,
        department: preDelete.department,
        quantity: preDelete.quantity,
        rate: preDelete.rate.toString(),
        billableDays: preDelete.billableDays,
        rateType: preDelete.rateType,
        lineTotal: preDelete.lineTotal.toString(),
        inventoryItemId: preDelete.inventoryItemId,
        assetCategoryId: preDelete.assetCategoryId,
        packageHeader: !!preDelete.isPackageHeader,
        packageMember: !!(preDelete.packageInstanceId && !preDelete.isPackageHeader),
        // Capture pickStatus so the LATE-STAGE-DELETE case (line was
        // already PICKED) is grep-able after the fact. The schema's
        // onDelete cascade currently loses this; the audit row is
        // the only place it survives.
        pickStatus: preDelete.pickStatus,
        fulfillmentLane: preDelete.fulfillmentLane,
      },
      newValues: null,
      userId: operatorId,
      ipAddress: extractIp(req),
    });
  }

  return NextResponse.json({ success: true, totals });
}
