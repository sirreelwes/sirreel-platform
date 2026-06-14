import { NextRequest, NextResponse } from "next/server";
import type { LineItemDepartment, RateType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { recalcOrderTotals, rentalDays as computeRentalDays } from "@/lib/orders";
import { computeLineTotal } from "@/lib/orders/billing";
import { auditLineItemEdit, extractIp, resolveOperatorId } from "@/lib/orders/auditLineItemEdit";
import { syncPickListOnLineAdd } from "@/lib/orders/pickListSync";

// PARKING LOT (Phase 2.x — warehouse PickList sync): if a line item is
// added/removed AFTER the order has been BOOKED (allowed during
// ON_JOB), this endpoint does NOT currently update the PickList.
// Adding a WAREHOUSE-department line needs a matching PickListItem
// (and a pickList row if none exists yet); removing a WAREHOUSE line
// needs the corresponding PickListItem cascade-deleted. Today the
// PickList is a book-time snapshot only. Tracked alongside bookOrder.ts.

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: orderId } = await params;

  try {
    const body = await req.json();
    const {
      type, description, inventoryItemId, assetCategoryId,
      startDate, endDate, rateType = "DAILY", rate, quantity = 1, notes,
      department, qualifier, billableDays, pickupDate, returnDate,
      // Package metadata. Headers carry packageId + isPackageHeader=true;
      // members share packageInstanceId. The line-total math is unchanged —
      // header rate drives the price; members come through as rate=0.
      packageInstanceId, packageId, isPackageHeader, isPackageModified,
    } = body;

    if (!type || !description || rate === undefined) {
      return NextResponse.json(
        { error: "type, description, and rate are required" },
        { status: 400 }
      );
    }

    const maxSort = await prisma.orderLineItem.aggregate({
      where: { orderId },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    // Resolve pickup/return FIRST so the days computation below can
    // fall back to the same window the row will actually bill against.
    // Previously days defaulted to 1 when no dates were supplied — even
    // though pickup/return would correctly inherit from the parent
    // Order — so a manually-added item on a 3-day order shipped with
    // billableDays=1 against a 3-day pickup/return range.
    let pickupResolved: Date;
    let returnResolved: Date;
    if (pickupDate && returnDate) {
      pickupResolved = new Date(pickupDate);
      returnResolved = new Date(returnDate);
    } else if (startDate && endDate) {
      pickupResolved = new Date(startDate);
      returnResolved = new Date(endDate);
    } else {
      const parent = await prisma.order.findUnique({
        where: { id: orderId },
        select: { startDate: true, endDate: true },
      });
      if (parent?.startDate && parent?.endDate) {
        pickupResolved = parent.startDate;
        returnResolved = parent.endDate;
      } else {
        // Final fallback (parent has no dates either). 1-day window so
        // computeRentalDays returns 1 below.
        pickupResolved = new Date();
        returnResolved = pickupResolved;
      }
    }

    // Resolve billable days. (STEP 1C) NULL is now a valid persisted
    // state — "dates TBD, rate-card line." Rules:
    //   - explicit positive number from client → use it
    //   - explicit null from client AND no committed dates → persist NULL
    //   - everything else (missing, 0, no value but dates present) →
    //     fall back to computeRentalDays from the resolved window,
    //     preserving the existing "added items inherit the order's
    //     billable days" behavior.
    let days: number | null;
    if (billableDays != null && Number(billableDays) > 0) {
      days = Math.floor(Number(billableDays));
    } else if (billableDays === null && !pickupDate && !returnDate) {
      days = null;
    } else {
      days = computeRentalDays(pickupResolved, returnResolved);
    }

    // Department is required by the new billing rules. If the client
    // didn't pass one, try to lift it from the catalog product; final
    // fallback is PRO_SUPPLIES (matches the schema default).
    let resolvedDepartment: LineItemDepartment = (department as LineItemDepartment) || 'PRO_SUPPLIES';
    if (!department) {
      if (inventoryItemId) {
        const inv = await prisma.inventoryItem.findUnique({
          where: { id: inventoryItemId }, select: { department: true },
        });
        if (inv) resolvedDepartment = inv.department;
      } else if (assetCategoryId) {
        const ac = await prisma.assetCategory.findUnique({
          where: { id: assetCategoryId }, select: { department: true },
        });
        if (ac) resolvedDepartment = ac.department;
      }
    }

    // computeLineTotal returns 0 when days is NULL — see billing.ts.
    const lineTotal = computeLineTotal({
      quantity: Number(quantity),
      rate: Number(rate),
      billableDays: days,
      rateType: rateType as RateType,
      department: resolvedDepartment,
    });

    const lineItem = await prisma.orderLineItem.create({
      data: {
        orderId, sortOrder, type, description,
        inventoryItemId: inventoryItemId || null,
        assetCategoryId: assetCategoryId || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        pickupDate: pickupResolved,
        returnDate: returnResolved,
        rateType, rate, quantity,
        billableDays: days,
        lineTotal: Math.round(lineTotal * 100) / 100,
        notes: notes || null,
        department: resolvedDepartment,
        ...(qualifier !== undefined ? { qualifier: qualifier || null } : {}),
        packageInstanceId: packageInstanceId || null,
        packageId: packageId || null,
        isPackageHeader: !!isPackageHeader,
        isPackageModified: !!isPackageModified,
      },
      include: {
        inventoryItem: { select: { id: true, code: true, description: true } },
        assetCategory: { select: { id: true, name: true } },
      },
    });

    // (#3a) PickList sync — fires regardless of order status. Reuses
    // bookOrder's routeDepartment so the lane/pickStatus assignment
    // is byte-identical to what the original book transition stamps.
    // For WAREHOUSE-routed lines, ensures a PickListItem exists; for
    // FLEET/STAGE, only stamps the lane. Three timing cases all
    // collapsed to "append no matter what" — even a sandbag added
    // after the list is LOADED gets a PENDING_PICK item appended for
    // the warehouse team to handle physically. The PickList state
    // is preserved — we never silently rewind to PICKING.
    const pickSync = await syncPickListOnLineAdd(prisma, {
      orderId,
      orderLineItemId: lineItem.id,
      department: resolvedDepartment,
    });

    const totals = await recalcOrderTotals(orderId);

    // AuditLog (#5) — fires only when the order is BOOKED+ (the
    // helper gates on status; pre-commitment DRAFT/QUOTE_SENT churn
    // is intentionally not logged). Non-fatal — a failed audit
    // doesn't block a successful add. ipAddress + operator id come
    // from the request + session.
    const parentOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (parentOrder) {
      const operatorId = await resolveOperatorId(session.user.email);
      await auditLineItemEdit({
        orderId,
        orderStatus: parentOrder.status,
        action: 'order.line_item_added',
        oldValues: null,
        newValues: {
          lineItemId: lineItem.id,
          description: lineItem.description,
          department: lineItem.department,
          quantity: lineItem.quantity,
          rate: lineItem.rate.toString(),
          billableDays: lineItem.billableDays,
          rateType: lineItem.rateType,
          lineTotal: lineItem.lineTotal.toString(),
          inventoryItemId: lineItem.inventoryItemId,
          assetCategoryId: lineItem.assetCategoryId,
          packageHeader: !!lineItem.isPackageHeader,
          packageMember: !!(lineItem.packageInstanceId && !lineItem.isPackageHeader),
          // (#3a) Record the PickList sync outcome on the audit row
          // so "what happened on the warehouse side?" is one query.
          fulfillmentLane: pickSync.lane,
          pickStatus: pickSync.pickStatus,
          pickListAction: pickSync.pickListAction,
        },
        userId: operatorId,
        ipAddress: extractIp(req),
      });
    }

    return NextResponse.json({ lineItem, totals }, { status: 201 });
  } catch (error) {
    console.error("Add line item error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
