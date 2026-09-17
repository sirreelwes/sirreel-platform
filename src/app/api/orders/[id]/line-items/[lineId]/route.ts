import { NextRequest, NextResponse } from "next/server";
import type { LineItemDepartment, RateType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { parseDriverEstimate } from "@/lib/orders/driverEstimate";
import { catalogIdForAssetCategory } from "@/lib/catalog/resolve";
import { getServerSession } from "next-auth";
import { recalcOrderTotals, estimateRentalDays } from "@/lib/orders";
import { syncOrderKitPieces } from "@/lib/orders/kitSync";
import { computeLineTotal } from "@/lib/orders/billing";
import { computeDays } from "@/lib/orders/days";
import { auditLineItemEdit, extractIp, resolveOperatorId } from "@/lib/orders/auditLineItemEdit";
import { readPickListItemForDelete, syncPickListOnLineAdd, syncPickListOnLineDelete } from "@/lib/orders/pickListSync";
import { routeDepartment } from "@/lib/orders/bookOrder";
import { isLineItemEditable, lineEditLockReason } from "@/lib/orders/editability";
import { checkHoldFeasibility, syncHoldOnLineDelete } from "@/lib/orders/holdsSync";
import { holdOnQuoteSend, holdCategoryForLine, planHoldSyncOnLineEdit, categoryStillQuoted } from "@/lib/orders/holdOnQuoteSend";
import { releaseBookingItem } from "@/lib/scheduling/releaseBookingItem";
import { syncReservationToLineDates, type FollowOutcome } from "@/lib/scheduling/followLineDates";
import { resolveLineRate, logRateOverride } from "@/lib/pricing/resolveRate";
import { syncOrderWindowSafe } from '@/lib/orders/syncOrderWindow'
import { partnerFloorGate } from '@/lib/sub-rentals/partnerMargins'

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
      startDate, endDate, rateType, rate, quantity, sortOrder, notes, driverEstimate,
      days: manualDays, billableDays, rentalDays: legacyRentalDays,
      department, qualifier, pickupDate, returnDate,
    } = body;

    // (Phase 1 step 4) Backend per-dept editability gate. Both the
    // existing department AND the new department (if it's being
    // changed) must pass the check — moving a line FROM VEHICLES on
    // a BOOKED order is still a "vehicle edit" and stays locked.
    const orderForGate = await prisma.order.findUnique({
      // companyId rides along for the client rate card — re-resolving a
      // rate must land on THEIR negotiated price, not list.
      where: { id: orderId }, select: { status: true, companyId: true },
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
    // The estimated driver day (roll / call / leave set / done). Validated
    // with the same clock rules the driver's actual hours use; null clears.
    if (driverEstimate !== undefined) {
      const est = parseDriverEstimate(driverEstimate);
      if (!est.ok) return NextResponse.json({ error: est.error }, { status: 400 });
      data.driverEstimate = est.value ?? Prisma.DbNull;
    }
    if (department !== undefined) data.department = department;
    if (qualifier !== undefined) data.qualifier = qualifier || null;

    // Inverted-range guard. Mirrors the line-items POST: rather than
    // silently flooring days to 1 via Math.max(1, …) downstream, reject
    // the write. Resolves the effective pickup/return pair by reading
    // the existing row when only one side is being patched.
    if (pickupDate !== undefined || returnDate !== undefined) {
      const existingForDates = await prisma.orderLineItem.findUnique({
        where: { id: lineId },
        select: { pickupDate: true, returnDate: true },
      });
      const effectivePickup =
        pickupDate !== undefined
          ? (pickupDate ? new Date(pickupDate) : null)
          : existingForDates?.pickupDate ?? null;
      const effectiveReturn =
        returnDate !== undefined
          ? (returnDate ? new Date(returnDate) : null)
          : existingForDates?.returnDate ?? null;
      // Keep the server-derived reference in step with date edits.
      if (effectivePickup && effectiveReturn) {
        data.computedDays = computeDays(effectivePickup, effectiveReturn);
      }
      if (
        effectivePickup &&
        effectiveReturn &&
        effectiveReturn.getTime() < effectivePickup.getTime()
      ) {
        return NextResponse.json(
          {
            error: 'invalid date range',
            reason: `Return date (${effectiveReturn.toISOString().slice(0, 10)}) is before pickup date (${effectivePickup.toISOString().slice(0, 10)}).`,
            pickupDate: effectivePickup.toISOString().slice(0, 10),
            returnDate: effectiveReturn.toISOString().slice(0, 10),
          },
          { status: 400 },
        );
      }
    }

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
        // Sprint 1 — server-side rate resolution on explicit rate/catalog
        // edits ONLY. Date/qty-only edits never re-resolve, so a Fleet
        // Pricing change after QUOTE_SENT can't silently rewrite a line.
        let effectiveRate = Number(existing.rate);
        const rateInputsChanged =
          rate !== undefined || rateType !== undefined ||
          inventoryItemId !== undefined || assetCategoryId !== undefined;
        if (rateInputsChanged) {
          const rr = await resolveLineRate({
            inventoryItemId: inventoryItemId !== undefined ? (inventoryItemId || null) : existing.inventoryItemId,
            assetCategoryId: assetCategoryId !== undefined ? (assetCategoryId || null) : existing.assetCategoryId,
            rateType: effectiveRateType,
            clientRate: rate !== undefined ? rate : existing.rate,
            isPackageMember: !!(existing.packageInstanceId && !existing.isPackageHeader),
            companyId: orderForGate?.companyId ?? null,
          });
          if (!rr) {
            return NextResponse.json({ error: "invalid rate" }, { status: 400 });
          }
          data.rate = rr.rate;
          data.resolvedRate = rr.resolvedRate;
          data.rateOverridden = rr.rateOverridden;
          effectiveRate = rr.rate.toNumber();
          // Log only when this edit introduces/changes an override value —
          // qty edits on an already-overridden line don't re-log.
          if (rr.rateOverridden && rr.resolvedRate && rate !== undefined && !rr.rate.equals(existing.rate)) {
            try {
              await logRateOverride(prisma, {
                orderId,
                orderLineItemId: lineId,
                resolvedRate: rr.resolvedRate,
                overrideRate: rr.rate,
                rateType: effectiveRateType,
                userId: await resolveOperatorId(session.user.email),
                ipAddress: extractIp(req),
              });
            } catch (err) {
              console.error('[pricing] rate-override audit failed:', err instanceof Error ? err.message : err);
            }
          }
        }
        const effectiveQty = Number(quantity ?? existing.quantity);
        const effectiveDept = (department as LineItemDepartment | undefined) ?? existing.department;

        let effectiveDays = existing.billableDays;
        if (dayInputProvided) {
          effectiveDays = Math.max(1, Math.floor(Number(explicitDays)));
        } else if (pickupDate !== undefined || returnDate !== undefined) {
          const p = pickupDate !== undefined ? (pickupDate ? new Date(pickupDate) : existing.pickupDate) : existing.pickupDate;
          const r = returnDate !== undefined ? (returnDate ? new Date(returnDate) : existing.returnDate) : existing.returnDate;
          if (p && r) {
            // Cube/camera trucks use the half-day-ends + weekly-cap rule.
            const effCatId = assetCategoryId !== undefined ? (assetCategoryId || null) : existing.assetCategoryId;
            let truckSlug: string | null = null;
            if (effCatId) {
              const effCatalogId = await catalogIdForAssetCategory(effCatId);
              const ac = effCatalogId
                ? await prisma.inventoryItem.findUnique({ where: { id: effCatalogId }, select: { slug: true } })
                : null;
              truckSlug = ac?.slug ?? null;
            }
            effectiveDays = estimateRentalDays(p, r, truckSlug);
          }
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

        // A partner unit priced below what SirReel's floor allows is refused
        // (discountWaterfall.ts). Any line is checked, not only partner lines:
        // a FIXED or flat-total order discount re-spreads when another line
        // moves. Exits at once on an order with no partner units.
        const floor = await partnerFloorGate(orderId, {
          line: { id: lineId, lineTotal: Math.round(lineTotal * 100) / 100, billableDays: effectiveDays, quantity: effectiveQty, rate: effectiveRate },
        });
        if (!floor.ok) {
          return NextResponse.json({ error: "below partner floor", reason: floor.message }, { status: 409 });
        }
      }
    }

    // (#5 AuditLog) Capture pre-update snapshot when the order is
    // post-APPROVED. Cheap read — only fires for committed-state
    // orders. For DRAFT/QUOTE_SENT the snapshot is skipped entirely.
    const parentOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, bookingId: true, orderNumber: true },
    });
    // APPROVED now joins the audited set (kill the island — matches
    // the rest of the codebase's "client has signed" semantic).
    const preUpdate = parentOrder && parentOrder.status !== 'DRAFT' && parentOrder.status !== 'QUOTE_SENT'
      ? await prisma.orderLineItem.findUnique({ where: { id: lineId } })
      : null;

    // Holds feasibility for a quantity or catalog-binding edit on a HELD
    // line. The class is resolved with `holdCategoryForLine` — the rule the
    // hold was created with — before and after the edit. This used to read
    // the line's own `assetCategoryId`, which every catalog-bound line
    // leaves null (the class lives on the catalog row), so for a real van
    // none of this ran: 1 → 2 vans left the hold at 1 and never asked
    // about capacity (2026-09-17, same gap the date-follow fix closed).
    // `planHoldSyncOnLineEdit` is the pure decision:
    //   (a) same class, quantity up   → only the increase must fit
    //   (b) a class the line did not hold before → the whole quantity
    //   (c) quantity down / leaving a class → nothing to ask
    // Only blocks on capacityClear=false + no confirmConflict — same
    // rule as POST. Co-tenancy with room available proceeds silently.
    const { confirmConflict: confirmConflictBody } = body as { confirmConflict?: unknown };
    const confirmConflict = confirmConflictBody === true;
    const fullExisting = await prisma.orderLineItem.findUnique({
      where: { id: lineId },
      include: {
        assetCategory: { select: { department: true } },
        inventoryItem: { select: { department: true, trackingMode: true, legacyAssetCategoryId: true } },
      },
    });
    if (!fullExisting) {
      return NextResponse.json({ error: 'line item not found' }, { status: 404 });
    }
    const oldQty = fullExisting.quantity;
    const oldDept = fullExisting.department;
    const newQty = quantity != null ? Number(quantity) : oldQty;
    const newDept = (department as LineItemDepartment | undefined) ?? oldDept;
    const oldCategoryId = holdCategoryForLine(fullExisting);
    // The order page sends both binding fields on every save, so "present
    // in the body" is not "changed" — compare against the row.
    const nextInventoryItemId = inventoryItemId !== undefined ? (inventoryItemId || null) : fullExisting.inventoryItemId;
    const nextAssetCategoryId = assetCategoryId !== undefined ? (assetCategoryId || null) : fullExisting.assetCategoryId;
    const bindingChanged =
      nextInventoryItemId !== fullExisting.inventoryItemId || nextAssetCategoryId !== fullExisting.assetCategoryId;
    const newCategoryId = !bindingChanged
      ? oldCategoryId
      : holdCategoryForLine({
          department: newDept,
          assetCategoryId: nextAssetCategoryId,
          assetCategory: nextAssetCategoryId
            ? await prisma.assetCategory.findUnique({ where: { id: nextAssetCategoryId }, select: { department: true } })
            : null,
          inventoryItem: nextInventoryItemId
            ? await prisma.inventoryItem.findUnique({
                where: { id: nextInventoryItemId },
                select: { department: true, trackingMode: true, legacyAssetCategoryId: true },
              })
            : null,
        });
    const holdPlan = planHoldSyncOnLineEdit({ oldCategoryId, newCategoryId, oldQty, newQty });
    let holdsAuditNote: string | null = null;
    let putHoldsCoTenancy: Awaited<ReturnType<typeof checkHoldFeasibility>>['conflicts'] = [];
    if (parentOrder?.bookingId && newCategoryId && holdPlan.feasibilityDelta > 0) {
      const proposedDelta = holdPlan.feasibilityDelta;
      // The days the line will sit on AFTER this edit — a quantity bump
      // saved together with a date move must fit on the new days.
      const feas = await checkHoldFeasibility({
        tx: prisma,
        categoryId: newCategoryId,
        startDate: pickupDate ? new Date(pickupDate) : fullExisting.pickupDate,
        endDate: returnDate ? new Date(returnDate) : fullExisting.returnDate,
        deltaQty: proposedDelta,
        excludeBookingId: parentOrder.bookingId,
      });
      putHoldsCoTenancy = feas.conflicts;
      if (!feas.capacityClear && !confirmConflict) {
        return NextResponse.json(
          {
            error: 'over-capacity',
            requiresConfirmation: true,
            reason: `Updating quantity to ${newQty} (delta +${proposedDelta}) would exceed available capacity. ${feas.conflicts.length} other booking(s) hold this category in the window.`,
            category: { id: newCategoryId },
            deltaQty: proposedDelta,
            availability: feas.availability,
            conflicts: feas.conflicts.map((c) => ({
              bookingNumber: c.bookingNumber,
              jobName: c.jobName,
              startDate: c.startDate.toISOString().slice(0, 10),
              endDate: c.endDate.toISOString().slice(0, 10),
              quantity: c.quantity,
              status: c.status,
            })),
          },
          { status: 409 },
        );
      }
      if (!feas.capacityClear && confirmConflict) {
        const orderLabel = parentOrder.orderNumber;
        const conflictList = feas.conflicts.map((c) => `${c.bookingNumber}${c.jobName ? ' / ' + c.jobName : ''}`).join('; ');
        holdsAuditNote = `CAPACITY OVERRIDE on ${orderLabel} (qty change Δ+${proposedDelta}): conflicts with ${conflictList}`;
      }
    }

    // Pricing an unpriced line IS how it stops being unpriced (2026-09-14).
    // A warehouse-added line the floor could not name off the catalog
    // lands with no rate and blocks the invoice; the moment somebody
    // puts a real number on it, the block lifts. Keyed on the rate the
    // update is actually writing, so saving an unrelated edit (a note, a
    // quantity) leaves the line stuck — which is right: nobody priced it.
    //
    // A deliberate $0 does NOT clear it. Zero is the state being flagged,
    // and "the agent looked and decided it is free" needs its own
    // gesture rather than being indistinguishable from never looking.
    if (data.rate !== undefined && new Prisma.Decimal(String(data.rate)).greaterThan(0)) {
      data.pricingPendingAt = null;
    }

    const lineItem = await prisma.orderLineItem.update({
      where: { id: lineId },
      data,
      include: {
        inventoryItem: { select: { id: true, code: true, description: true } },

      },
    });

    // Hold-side write — fires AFTER the line update, because the writer
    // reads the order's lines. `holdOnQuoteSend` is that writer: it SETs
    // every class this order (and its booking siblings) still quotes to the
    // PEAK CONCURRENT need and widens the envelope. It replaced the
    // delta-accumulating `syncHoldOnLineUpdate` here — a delta sums, and one
    // van quoted for two separate weeks is one van. It also mints the
    // booking when the order had none (a free-typed line bound to a real
    // van), which is the POST route's "held the moment it is quoted" rule.
    //
    // Two things the recompute does NOT do, handled below:
    //   · it never shrinks a hold whose units are already ASSIGNED — that
    //     is dispatch's work — so a quantity cut on a bound line is REPORTED
    //     (`holds.note`) instead of silently leaving the board over-held;
    //   · it only visits classes still quoted, so a class the line LEFT is
    //     released here, by asset. Never `syncHoldOnLineDelete`: at zero it
    //     deletes the BookingItem and the cascade takes every unit on it.
    let holdsOutcome: {
      categoryId: string | null
      quantityBefore: number | null
      quantityAfter: number | null
      releasedUnits: string[]
      note: string | null
    } | null = null;
    if (holdPlan.recompute && (parentOrder?.bookingId || newCategoryId)) {
      const operatorIdForAudit = await resolveOperatorId(session.user.email);
      const liveItem = async (bookingId: string | null | undefined, categoryId: string | null) =>
        bookingId && categoryId
          ? prisma.bookingItem.findFirst({
              where: { bookingId, categoryId, status: { in: ['REQUESTED', 'ASSIGNED'] } },
              orderBy: { holdRank: 'asc' },
              select: { id: true, quantity: true, status: true, notes: true },
            })
          : null;
      const before = await liveItem(parentOrder?.bookingId, newCategoryId);

      const raised = await holdOnQuoteSend(orderId);
      if (raised.error) console.error('[line-items] hold recompute failed (PUT):', raised.error);
      const bookingIdNow =
        parentOrder?.bookingId ??
        (await prisma.order.findUnique({ where: { id: orderId }, select: { bookingId: true } }))?.bookingId ??
        null;
      const after = await liveItem(bookingIdNow, newCategoryId);

      // The class the line left, when nothing on the booking quotes it any
      // more. This order's units come off by asset — the ones on the line's
      // own days first — and the rest of the line's count as pooled slots.
      const releasedUnits: string[] = [];
      if (holdPlan.releaseCategoryId && bookingIdNow && !(await categoryStillQuoted(orderId, holdPlan.releaseCategoryId))) {
        const oldItem = await prisma.bookingItem.findFirst({
          where: { bookingId: bookingIdNow, categoryId: holdPlan.releaseCategoryId, status: { in: ['REQUESTED', 'ASSIGNED'] } },
          orderBy: { holdRank: 'asc' },
          select: {
            id: true,
            assignments: {
              where: { status: { in: ['ASSIGNED', 'CHECKED_OUT'] }, OR: [{ orderId }, { orderId: null }] },
              select: { assetId: true, startDate: true, endDate: true, asset: { select: { unitName: true } } },
            },
          },
        });
        if (oldItem) {
          const onLineDays = (a: { startDate: Date; endDate: Date }) =>
            a.startDate.getTime() === fullExisting.pickupDate.getTime() && a.endDate.getTime() === fullExisting.returnDate.getTime();
          const mine = [...oldItem.assignments]
            .sort((a, b) => Number(onLineDays(b)) - Number(onLineDays(a)))
            .slice(0, oldQty);
          const rel = await releaseBookingItem(oldItem.id, {
            assetIds: mine.map((a) => a.assetId),
            pooledSlots: Math.max(0, oldQty - mine.length),
            actor: {
              userId: operatorIdForAudit,
              source: 'line-edit',
              reason: `${parentOrder?.orderNumber ?? 'order'}: "${fullExisting.description}" no longer holds this class`,
            },
          });
          if (rel.ok) releasedUnits.push(...mine.map((a) => a.asset.unitName));
          else console.error('[line-items] old-class release failed (PUT):', rel.reason);
        }
      }

      const stuck =
        !!before && !!after && oldCategoryId === newCategoryId && newQty < oldQty &&
        after.quantity === before.quantity && before.status === 'ASSIGNED';
      holdsOutcome = {
        categoryId: newCategoryId,
        quantityBefore: before?.quantity ?? (newCategoryId ? 0 : null),
        quantityAfter: after?.quantity ?? (newCategoryId ? 0 : null),
        releasedUnits,
        note: raised.error
          ? `The line saved, but the reservation could not be updated (${raised.error}). Check the hold on the board.`
          : stuck
            ? `The reservation still holds ${after!.quantity} — its units are already assigned. Release the one you no longer need from the reservation.`
            : releasedUnits.length > 0
              ? `${releasedUnits.join(', ')} released — this line no longer holds that class.`
              : null,
      };

      // The override, where dispatch reads it: on the hold and in the log.
      if (holdsAuditNote) {
        try {
          if (after) {
            const stamp = `[${new Date().toISOString().slice(0, 16)}] ${holdsAuditNote}`;
            await prisma.bookingItem.update({
              where: { id: after.id },
              data: { notes: after.notes ? `${after.notes}\n${stamp}` : stamp },
            });
          }
          await prisma.auditLog.create({
            data: {
              userId: operatorIdForAudit,
              ipAddress: extractIp(req),
              action: 'booking_item.conflict_override',
              entityType: 'OrderLineItem',
              entityId: lineId,
              oldValues: { conflicts: putHoldsCoTenancy.map((c) => ({
                bookingNumber: c.bookingNumber,
                jobName: c.jobName,
                quantity: c.quantity,
                status: c.status,
              })) },
              newValues: {
                orderId,
                orderLineItemId: lineId,
                deltaQty: holdPlan.feasibilityDelta,
                newQty,
                holdQuantityAfter: after?.quantity ?? null,
                note: holdsAuditNote,
              },
            },
          });
        } catch (err) {
          console.error('[holds] override audit failed (PUT):', err instanceof Error ? err.message : err);
        }
      }
    }

    // THE DATES MOVED on a held line: the reservation follows (Wes
    // 2026-09-17, Someday Studios — the order said the 17th, the board
    // still drew the van on the 18th). One implementation for this route
    // and "Change dates…": recompute the hold (peak, envelope), re-stamp
    // the UNIT onto the new days, re-fit the envelope. This used to gate
    // on the line's own `assetCategoryId`, which a catalog-bound vehicle
    // leaves null, so it never ran for a real van; the module resolves
    // the class the way the hold was created. Idempotent + non-fatal.
    let assignmentsFollowed: FollowOutcome | null = null;
    if (parentOrder?.bookingId) {
      const movedPickup =
        pickupDate !== undefined && lineItem.pickupDate.getTime() !== fullExisting.pickupDate.getTime();
      const movedReturn =
        returnDate !== undefined && lineItem.returnDate.getTime() !== fullExisting.returnDate.getTime();
      if (movedPickup || movedReturn) {
        assignmentsFollowed = await syncReservationToLineDates({
          orderId,
          changes: [{
            lineId,
            from: { start: fullExisting.pickupDate, end: fullExisting.returnDate },
            to: { start: lineItem.pickupDate, end: lineItem.returnDate },
          }],
          actor: { userId: await resolveOperatorId(session.user.email), ipAddress: extractIp(req) },
        });
        if (assignmentsFollowed.error) {
          console.error('[line-items] reservation did not follow the date change:', assignmentsFollowed.error);
        }
      }
    }

    // PickList sync on dept change. The holds-sync block above only
    // covers VEHICLES/STAGES → BookingItem; this block covers the
    // WAREHOUSE / non-WAREHOUSE boundary so a dept reassignment
    // doesn't leave an orphan PickListItem (WAREHOUSE → FLEET) or
    // skip creating one (FLEET → WAREHOUSE). The same syncPickListOn
    // helpers the POST route uses — single source of truth.
    if (department !== undefined && oldDept !== newDept) {
      const oldRouting = routeDepartment(oldDept);
      const newRouting = routeDepartment(newDept);
      if (oldRouting.lane === 'WAREHOUSE' && newRouting.lane !== 'WAREHOUSE') {
        // Leaving the WAREHOUSE lane — drop the PickListItem. The
        // helper handles the un-pick audit when the item was already
        // physically picked, and auto-CANCELs the PickList if this
        // was the last item.
        const snap = await readPickListItemForDelete(prisma, lineId);
        const operatorId = await resolveOperatorId(session.user.email);
        await syncPickListOnLineDelete(prisma, {
          orderId,
          orderLineItemId: lineId,
          pickListItem: snap,
          pickStatusAtDelete: (fullExisting.pickStatus as 'PENDING_PICK' | 'PICKED' | 'STAGED' | 'LOADED' | null) ?? null,
          userId: operatorId,
          ipAddress: extractIp(req),
        });
        // Update fulfillmentLane/pickStatus on the row. syncPickListOnLineAdd
        // would have done this for us if the new lane were WAREHOUSE,
        // but we're going the other direction.
        await prisma.orderLineItem.update({
          where: { id: lineId },
          data: { fulfillmentLane: newRouting.lane, pickStatus: newRouting.pickStatus },
        });
      } else if (oldRouting.lane !== 'WAREHOUSE' && newRouting.lane === 'WAREHOUSE') {
        // Entering the WAREHOUSE lane — create a PickListItem. The
        // helper also re-stamps fulfillmentLane + pickStatus to match
        // the new routing, so no separate update needed.
        await syncPickListOnLineAdd(prisma, {
          orderId,
          orderLineItemId: lineId,
          department: newDept,
        });
      } else if (oldRouting.lane !== newRouting.lane) {
        // Cross-lane transition where neither side is WAREHOUSE (e.g.
        // FLEET ↔ STAGE). No PickListItem either way; just re-stamp
        // the lane / pickStatus so the row's spine is honest.
        await prisma.orderLineItem.update({
          where: { id: lineId },
          data: { fulfillmentLane: newRouting.lane, pickStatus: newRouting.pickStatus },
        });
      }
      // Same-lane dept change (e.g. PRO_SUPPLIES → GE both WAREHOUSE)
      // needs nothing — fulfillmentLane / pickStatus / PickListItem
      // all stay valid.
    }

    // A quantity edit resizes the kit: 12 radios down to 6 owes one
    // charging bank, not two. Only lines this reconciler created move —
    // a battery the client ordered themselves is left alone.
    const kitSync = await syncOrderKitPieces(prisma, orderId);

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

    await syncOrderWindowSafe(orderId);
    return NextResponse.json({
      lineItem,
      totals,
      kit: kitSync.noop ? null : kitSync,
      // Which units moved with the dates, and which could not (booked
      // elsewhere on the new days). Null when no held line's dates moved.
      // The page says it out loud — a van that silently stayed on the old
      // days is how the board and the order came to disagree.
      assignmentsFollowed,
      // What the hold did about a quantity / catalog edit: its quantity
      // before and after the peak recompute, units released from a class
      // the line left, and a note when the rep still has something to do.
      // Null when the edit owed the hold nothing.
      holds: holdsOutcome,
    });
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

  // (#2 Phase 2) Hold side delete — VEHICLES / STAGES only. Decrements
  // BookingItem.quantity by the deleted line's qty; deletes the row
  // when qty hits 0 so the schedule view doesn't show a phantom hold.
  let deleteHoldsResult: Awaited<ReturnType<typeof syncHoldOnLineDelete>> | null = null;
  if (
    parentOrder &&
    (lineRow.department === 'VEHICLES' || lineRow.department === 'STAGES') &&
    lineRow.assetCategoryId
  ) {
    const parentOrderForBooking = await prisma.order.findUnique({
      where: { id: orderId }, select: { bookingId: true },
    });
    if (parentOrderForBooking?.bookingId) {
      deleteHoldsResult = await syncHoldOnLineDelete(prisma, {
        bookingId: parentOrderForBooking.bookingId,
        categoryId: lineRow.assetCategoryId,
        removedQty: lineRow.quantity,
      });
    }
  }

  // Removing the radios takes their charging bank with them. Pieces
  // already PICKED or beyond stay put — that gear is on a cart, and
  // silently dropping the line would erase the only record of it.
  const kitSync = await syncOrderKitPieces(prisma, orderId);

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

  await syncOrderWindowSafe(orderId);

  return NextResponse.json({
    success: true,
    totals,
    kit: kitSync.noop ? null : kitSync,
    // (#3b) Surface what happened on the warehouse side so the UI
    // can render a toast — e.g. "Item returned to stock; pick list
    // updated" vs the silent before.
    pickList: {
      action: pickListItemSnapshot ? 'pick_list_item_removed' : 'no_pick_list_side',
      recomputed: pickRecompute.pickListRecomputed,
      wasPicked: alreadyPicked,
    },
    // (#2 Phase 2) Holds outcome on delete — null for non-hold lines
    // or orders with no Booking. quantityAfter=0 → the BookingItem
    // row was removed; otherwise just decremented.
    holds: deleteHoldsResult,
  });
}
