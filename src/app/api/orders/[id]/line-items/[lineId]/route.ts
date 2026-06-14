import { NextRequest, NextResponse } from "next/server";
import type { LineItemDepartment, RateType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { recalcOrderTotals, rentalDays as computeRentalDays } from "@/lib/orders";
import { computeLineTotal } from "@/lib/orders/billing";
import { auditLineItemEdit, extractIp, resolveOperatorId } from "@/lib/orders/auditLineItemEdit";
import { readPickListItemForDelete, syncPickListOnLineDelete } from "@/lib/orders/pickListSync";
import { isLineItemEditable, lineEditLockReason } from "@/lib/orders/editability";

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

    // (Phase 1 step 4) Backend per-dept editability gate. Both the
    // existing department AND the new department (if it's being
    // changed) must pass the check — moving a line FROM VEHICLES on
    // a BOOKED order is still a "vehicle edit" and stays locked.
    const orderForGate = await prisma.order.findUnique({
      where: { id: orderId }, select: { status: true },
    });
    const existingLineForGate = await prisma.orderLineItem.findUnique({
      where: { id: lineId }, select: { department: true },
    });
    if (!orderForGate || !existingLineForGate) {
      return NextResponse.json({ error: "order or line item not found" }, { status: 404 });
    }
    const currentDept = existingLineForGate.department;
    const nextDept = (department as LineItemDepartment | undefined) ?? currentDept;
    if (
      !isLineItemEditable(orderForGate.status, currentDept) ||
      !isLineItemEditable(orderForGate.status, nextDept)
    ) {
      const blockedDept = !isLineItemEditable(orderForGate.status, currentDept) ? currentDept : nextDept;
      const reason = lineEditLockReason(orderForGate.status, blockedDept);
      return NextResponse.json(
        {
          error: 'line edit not permitted',
          reason: reason ?? 'edit not permitted in current order state',
          orderStatus: orderForGate.status,
          department: blockedDept,
        },
        { status: 409 },
      );
    }

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
    // APPROVED now joins the audited set (kill the island — matches
    // the rest of the codebase's "client has signed" semantic).
    const preUpdate = parentOrder && parentOrder.status !== 'DRAFT' && parentOrder.status !== 'QUOTE_SENT'
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

  // (#3b) Confirmation flag for the already-picked physical-pull
  // case. DELETE allows a JSON body; older clients that send no body
  // get `confirmedPicked: false` which is the safe default. Frontend
  // re-submits with `{ confirmedPicked: true }` after the rep
  // acknowledges the physical-stock-return consequence.
  let confirmedPicked = false;
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body === 'object' && (body as { confirmedPicked?: unknown }).confirmedPicked === true) {
      confirmedPicked = true;
    }
  } catch {
    /* no body — treat as not confirmed */
  }

  // (#5 AuditLog) Snapshot the row + parent status BEFORE the
  // cascade-delete fires. Always read the row regardless of status
  // (#3b) — we need the pickStatus to decide whether confirmation
  // is required, even for DRAFT/QUOTE_SENT orders that would
  // otherwise skip the audit branch.
  const parentOrder = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  const lineRow = await prisma.orderLineItem.findUnique({
    where: { id: lineId },
    select: {
      id: true, description: true, department: true, quantity: true,
      rate: true, billableDays: true, rateType: true, lineTotal: true,
      inventoryItemId: true, assetCategoryId: true,
      isPackageHeader: true, packageInstanceId: true,
      pickStatus: true, fulfillmentLane: true,
    },
  });
  if (!lineRow) {
    return NextResponse.json({ error: 'line item not found' }, { status: 404 });
  }

  // (Phase 1 step 4) Per-dept editability gate — reject VEHICLES /
  // STAGES deletes on post-BOOKED orders. Same rule as the POST /
  // PUT handlers.
  if (parentOrder && !isLineItemEditable(parentOrder.status, lineRow.department)) {
    const reason = lineEditLockReason(parentOrder.status, lineRow.department);
    return NextResponse.json(
      {
        error: 'line delete not permitted',
        reason: reason ?? 'delete not permitted in current order state',
        orderStatus: parentOrder.status,
        department: lineRow.department,
      },
      { status: 409 },
    );
  }

  // (#3b) PickList side — pre-read the PickListItem so we have the
  // picker stamp metadata before any delete fires. Determines whether
  // confirmation is required.
  const pickListItemSnapshot = await readPickListItemForDelete(prisma, lineId);
  const alreadyPicked =
    lineRow.pickStatus === 'PICKED' ||
    lineRow.pickStatus === 'STAGED' ||
    lineRow.pickStatus === 'LOADED';

  if (alreadyPicked && !confirmedPicked) {
    return NextResponse.json(
      {
        requiresConfirmation: true,
        reason: 'already_picked',
        pickStatus: lineRow.pickStatus,
        physicalAction: 'return_to_stock',
        message:
          `This item was already ${(lineRow.pickStatus || '').toLowerCase()} — deleting it removes it from the order. ` +
          `Return the physical item to stock before confirming.`,
      },
      { status: 409 },
    );
  }

  // The audit-snapshot subset (mirrors step 1's existing payload).
  // Only kept for the BOOKED+/post-APPROVED branch; DRAFT/QUOTE_SENT
  // skip the audit emit per the existing helper.
  const preDelete = parentOrder && parentOrder.status !== 'DRAFT' && parentOrder.status !== 'QUOTE_SENT'
    ? lineRow
    : null;

  // (#3b) Explicit PickList side delete BEFORE the OrderLineItem
  // delete, replacing the silent onDelete: Cascade. Captures the
  // un-pick AuditLog row when relevant, then removes the PickListItem.
  // The OrderLineItem.delete below would have cascade-deleted the
  // PickListItem anyway — by pre-deleting we control the order of
  // events and surface the picker-stamp loss in AuditLog.
  let pickRecompute: { pickListRecomputed: 'unchanged' | 'cancelled_empty' | 'none' } = { pickListRecomputed: 'none' };
  if (pickListItemSnapshot) {
    const operatorIdForUnpick = await resolveOperatorId(session.user.email);
    pickRecompute = await syncPickListOnLineDelete(prisma, {
      orderId,
      orderLineItemId: lineId,
      pickListItem: pickListItemSnapshot,
      pickStatusAtDelete: lineRow.pickStatus,
      userId: operatorIdForUnpick,
      ipAddress: extractIp(req),
    });
  }

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

  return NextResponse.json({
    success: true,
    totals,
    // (#3b) Surface what happened on the warehouse side so the UI
    // can render a toast — e.g. "Item returned to stock; pick list
    // updated" vs the silent before.
    pickList: {
      action: pickListItemSnapshot ? 'pick_list_item_removed' : 'no_pick_list_side',
      recomputed: pickRecompute.pickListRecomputed,
      wasPicked: alreadyPicked,
    },
  });
}
