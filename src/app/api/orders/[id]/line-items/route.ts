import { NextRequest, NextResponse } from "next/server";
import { Prisma, type LineItemDepartment, type RateType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { catalogIdForAssetCategory } from "@/lib/catalog/resolve";
import { getServerSession } from "next-auth";
import { recalcOrderTotals, estimateRentalDays } from "@/lib/orders";
import { computeLineTotal, weeklyRateApplies, weeklyRateCap, computeBillableDays } from "@/lib/orders/billing";
import { computeDays, isClaimEligible, sanitizeClaimedDays } from "@/lib/orders/days";
import { auditLineItemEdit, extractIp, resolveOperatorId } from "@/lib/orders/auditLineItemEdit";
import { syncPickListOnLineAdd } from "@/lib/orders/pickListSync";
import { syncOrderKitPieces } from "@/lib/orders/kitSync";
import { isLineItemEditable, lineEditLockReason } from "@/lib/orders/editability";
import { checkHoldFeasibility, syncHoldOnLineAdd } from "@/lib/orders/holdsSync";
import { holdOnQuoteSend, reconcileHoldFirmness } from "@/lib/orders/holdOnQuoteSend";
import { resolveLineRate, resolveFeeLineRate, resolveRate, logRateOverride, type LineRateResult } from "@/lib/pricing/resolveRate";
import { syncOrderWindowSafe } from '@/lib/orders/syncOrderWindow'
import { assignUnitsForLine, parseUnitAssignment, type UnitAssignmentOutcome } from '@/lib/orders/assignUnitsForLine'

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
      // A PARTNER's unit picked from the catalog box. Not a catalog FK — it
      // lives in SubcontractedVehicle — so it creates the SubRental behind
      // the line instead of binding one.
      subcontractedVehicleId,
      startDate, endDate, rateType = "DAILY", rate, quantity = 1, notes,
      department, qualifier, billableDays, pickupDate, returnDate, claimedDays,
      // Package metadata. Headers carry packageId + isPackageHeader=true;
      // members share packageInstanceId. The line-total math is unchanged —
      // header rate drives the price; members come through as rate=0.
      packageInstanceId, packageId, isPackageHeader, isPackageModified,
      // (Phase 2) Override flag for the loud capacity-conflict 409 on
      // VEHICLES/STAGES adds. When the rep sees the named-other-bookings
      // dialog and confirms the override anyway, the UI re-POSTs with
      // confirmConflict=true. Stamps note + emits AuditLog row so
      // dispatch sees the override.
      confirmConflict,
      // Fee-catalog add (type=FEE lines). The server prices the line
      // from FeeItem.amount — the client's `rate` is an override
      // request, same trust model as catalog lines. `percentBase` is
      // the dollar base for PERCENT-unit fees.
      feeItemId,
      percentBase,
      // Which TRUCK goes on a vehicle line (Wes 2026-09-10). Default is
      // "next available"; `{ mode: 'named', assetIds }` binds the units
      // the rep picked; `{ mode: 'none' }` leaves the hold at class
      // level (the Make Reservation modal ranks first, then binds).
      unitAssignment,
    } = body;

    // Fee adds derive type/description/rate from the FeeItem — only the
    // id is mandatory. Everything else keeps the strict contract.
    if (!feeItemId && (!type || !description || rate === undefined)) {
      return NextResponse.json(
        { error: "type, description, and rate are required" },
        { status: 400 }
      );
    }

    // (Phase 1 step 4) Backend per-dept editability gate. Mirrors the
    // UI rule from src/lib/orders/editability.ts — single source of
    // truth. Post-BOOKED orders reject VEHICLES/STAGES adds until
    // Phase 2's holds-sync lands. Pre-BOOKED orders allow all depts.
    const orderForGate = await prisma.order.findUnique({
      where: { id: orderId },
      // companyId rides along for the client rate card — a line added to
      // an order for a client with a negotiated rate bills at THEIR rate.
      select: { status: true, companyId: true },
    });
    if (!orderForGate) {
      return NextResponse.json({ error: "order not found" }, { status: 404 });
    }
    // Determine the department this line will land in. If the caller
    // didn't pass `department` but did pass an inventoryItemId or
    // assetCategoryId, we need to lift the catalog-side default for
    // the gate check to be correct. Mirrors the resolve logic below.
    let gateDepartment: LineItemDepartment = (department as LineItemDepartment) || 'PRO_SUPPLIES';
    if (!department && !feeItemId) {
      if (inventoryItemId) {
        const inv = await prisma.inventoryItem.findUnique({
          where: { id: inventoryItemId }, select: { department: true },
        });
        if (inv) gateDepartment = inv.department;
      } else if (assetCategoryId) {
        const acId = await catalogIdForAssetCategory(assetCategoryId)
        const ac = acId
          ? await prisma.inventoryItem.findUnique({
              where: { id: acId }, select: { department: true },
            })
          : null;
        if (ac) gateDepartment = ac.department;
      }
    }
    if (!isLineItemEditable(orderForGate.status, gateDepartment)) {
      const reason = lineEditLockReason(orderForGate.status, gateDepartment);
      return NextResponse.json(
        {
          error: 'line edit not permitted',
          reason: reason ?? 'edit not permitted in current order state',
          orderStatus: orderForGate.status,
          department: gateDepartment,
        },
        { status: 409 },
      );
    }

    // HYBRID GUARD — Lankershim facility double-billing prevention.
    // If the order already carries the Lankershim Studios Facility
    // package, refuse to add a standalone LANKERSHIM_* InventoryItem
    // line à la carte. The areas inside the package scope are already
    // covered by the $3,750 facility rate; adding the same area
    // separately at $125 would charge the client twice for one space.
    //
    // The guard fires only when:
    //   1. This is a STANDALONE add (no packageInstanceId — i.e. not
    //      coming from /from-package expansion), AND
    //   2. The incoming line references an InventoryItem whose code
    //      starts with `LANKERSHIM_`, AND
    //   3. The order already has any line marked isPackageHeader with
    //      a packageId whose package name starts with "Lankershim
    //      Studios" (the facility package).
    //
    // The LED Wall Usage item (LANKERSHIM_LED_WALL_USAGE) is EXEMPT —
    // it's not a package member by design, and adding it on top of
    // the facility package is the intended hybrid (+$1,000 upcharge).
    if (!packageInstanceId && inventoryItemId) {
      const inv = await prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        select: { code: true, description: true },
      });
      if (inv?.code?.startsWith('LANKERSHIM_') && inv.code !== 'LANKERSHIM_LED_WALL_USAGE') {
        const lankPkgHeader = await prisma.orderLineItem.findFirst({
          where: {
            orderId,
            isPackageHeader: true,
            package: { name: { startsWith: 'Lankershim Studios' } },
          },
          select: { id: true, description: true, package: { select: { name: true } } },
        });
        if (lankPkgHeader) {
          return NextResponse.json(
            {
              error: 'duplicate facility billing',
              reason: `"${inv.description ?? inv.code}" is already covered by the Lankershim Studios facility package on this order — adding it separately would double-bill the client. Scope the area into the package via the existing facility line instead.`,
              orderLineItemId: lankPkgHeader.id,
              packageName: lankPkgHeader.package?.name ?? null,
            },
            { status: 409 },
          );
        }
      }
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

    // Inverted-range guard. Previously every days helper silently
    // floored a `return < pickup` window to 1 day, so an order
    // inheriting bad parent dates wrote billableDays=1 and a wrong
    // lineTotal with no warning. Reject at the write boundary so the
    // bad data can't land in the first place.
    if (returnResolved.getTime() < pickupResolved.getTime()) {
      return NextResponse.json(
        {
          error: 'invalid date range',
          reason: `Return date (${returnResolved.toISOString().slice(0, 10)}) is before pickup date (${pickupResolved.toISOString().slice(0, 10)}). Fix the order's date range first.`,
          pickupDate: pickupResolved.toISOString().slice(0, 10),
          returnDate: returnResolved.toISOString().slice(0, 10),
        },
        { status: 400 },
      );
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
      // Cube/camera trucks bill rental days on the half-day-ends + weekly-cap
      // rule; every other category keeps the standard inclusive count.
      let truckSlug: string | null = null;
      if (assetCategoryId) {
        const slugId = await catalogIdForAssetCategory(assetCategoryId)
        const acSlug = slugId
          ? await prisma.inventoryItem.findUnique({
              where: { id: slugId }, select: { slug: true },
            })
          : null;
        truckSlug = acSlug?.slug ?? null;
      }
      days = estimateRentalDays(pickupResolved, returnResolved, truckSlug);
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
        const acId = await catalogIdForAssetCategory(assetCategoryId)
        const ac = acId
          ? await prisma.inventoryItem.findUnique({
              where: { id: acId }, select: { department: true },
            })
          : null;
        if (ac) resolvedDepartment = ac.department;
      }
    }

    // (#2 Phase 2) Pre-flight holds feasibility for VEHICLES / STAGES.
    // Fires BEFORE OrderLineItem.create so a hard-block 409 doesn't
    // leave an orphan row. Gated on three conditions:
    //   - department is hold-tracked (VEHICLES or STAGES)
    //   - the order has a Booking row attached (bookingId non-null)
    //   - the line specifies an assetCategoryId to hold against
    // Per ratification: confirm-required ONLY when capacityClear=false
    // (genuine over-allocation). Co-tenancy WITH room available
    // proceeds silently — the wide-net `conflicts` list is informational
    // and surfaces on the success response so the rep sees who they're
    // sharing the category with, but does NOT block or require confirm.
    let holdsCoTenancy: Awaited<ReturnType<typeof checkHoldFeasibility>>['conflicts'] = [];
    let holdsAvailability: Awaited<ReturnType<typeof checkHoldFeasibility>>['availability'] | null = null;
    let holdsOverrideNote: string | null = null;
    const isHoldDept = resolvedDepartment === 'VEHICLES' || resolvedDepartment === 'STAGES';
    // The category this line HOLDS against. A catalog pick is an INVENTORY
    // row — "Cargo Van w/ Liftgate" off the order form's catalog box has
    // no assetCategoryId — so until 2026-09-10 a vehicle added that way
    // held nothing and bound no unit until the quote was SENT (Wes: "no
    // prompt to put a van on reservation once I added it"). Resolved the
    // way holdOnQuoteSend resolves it: unit-tracked + legacyAssetCategoryId.
    let holdCategoryId: string | null = assetCategoryId || null;
    if (!holdCategoryId && isHoldDept && inventoryItemId) {
      const invHold = await prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        select: { trackingMode: true, legacyAssetCategoryId: true },
      });
      if (invHold?.trackingMode === 'UNIT_TRACKED' && invHold.legacyAssetCategoryId) {
        holdCategoryId = invHold.legacyAssetCategoryId;
      }
    }
    const wantsHoldSync = isHoldDept && !!holdCategoryId;
    let parentBookingId: string | null = null;
    if (wantsHoldSync) {
      const parentOrderForBooking = await prisma.order.findUnique({
        where: { id: orderId }, select: { bookingId: true, orderNumber: true },
      });
      parentBookingId = parentOrderForBooking?.bookingId ?? null;
      if (parentBookingId) {
        const feas = await checkHoldFeasibility({
          tx: prisma,
          categoryId: holdCategoryId!,
          startDate: pickupResolved,
          endDate: returnResolved,
          deltaQty: Number(quantity),
          excludeBookingId: parentBookingId,
        });
        holdsCoTenancy = feas.conflicts;
        holdsAvailability = feas.availability;
        if (!feas.capacityClear && confirmConflict !== true) {
          // Loud confirm-required 409 — capacity gate failed, rep hasn't
          // overridden yet. Names every conflicting booking so the rep
          // knows EXACTLY who they'd be stepping on, not just "no room."
          return NextResponse.json(
            {
              error: 'over-capacity',
              requiresConfirmation: true,
              reason: `Adding ${quantity} unit(s) would exceed the category's available capacity for ${pickupResolved.toISOString().slice(0,10)}–${returnResolved.toISOString().slice(0,10)}. ${feas.conflicts.length} other booking(s) hold this category in the window.`,
              category: { id: holdCategoryId },
              deltaQty: Number(quantity),
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
        if (!feas.capacityClear && confirmConflict === true) {
          // Build the dispatch-visible override note now; stamped on
          // BookingItem.notes by syncHoldOnLineAdd below.
          const orderLabel = parentOrderForBooking?.orderNumber ?? orderId;
          const conflictList = feas.conflicts.map((c) => `${c.bookingNumber}${c.jobName ? ' / ' + c.jobName : ''}`).join('; ');
          holdsOverrideNote = `CAPACITY OVERRIDE on ${orderLabel} (qty +${quantity}): conflicts with ${conflictList}`;
        }
      }
    }

    // Sprint 1 — server-side rate resolution. The client-sent `rate` is
    // an override REQUEST checked against Fleet Pricing/catalog truth;
    // an override persists on the row (rateOverridden + resolvedRate)
    // and is audit-logged below. $0 package members / includedFree lines
    // are not overrides.
    //
    // Fee-catalog lines (feeItemId) price from FeeItem.amount instead:
    //   FLAT       — qty × amount            (qty = count, days forced 1)
    //   PER_DAY    — amount × rental days    (qty forced 1, days = order window)
    //   PER_HOUR   — qty × amount            (qty = hours, days forced 1)
    //   PER_MILE   — qty × amount            (qty = miles, days forced 1)
    //   PER_GALLON — qty × amount            (qty = gallons, days forced 1)
    //   PERCENT    — amount% × percentBase   (qty 1 × 1 day, one-shot)
    // All of it flows through the SAME computeLineTotal below — the fee
    // just controls which inputs (qty/days/rate) carry the multiplier.
    let rateResolution: LineRateResult | null;
    let effectiveType = type;
    let effectiveDescription = description;
    let effectiveRateType = rateType as RateType;
    let effectiveQuantity = Number(quantity);
    if (feeItemId) {
      const feeRes = await resolveFeeLineRate({ feeItemId, clientRate: rate, percentBase });
      if (!feeRes) {
        return NextResponse.json(
          { error: "invalid fee", reason: "Fee not found / inactive, bad rate, or missing percent base." },
          { status: 400 },
        );
      }
      rateResolution = feeRes;
      effectiveType = 'FEE';
      resolvedDepartment = 'PRO_SUPPLIES';
      effectiveDescription = description ||
        (feeRes.fee.unit === 'PERCENT'
          ? `${feeRes.fee.name} (${Number(percentBase) ? `on $${Number(percentBase).toFixed(2)}` : 'percent'})`
          : feeRes.fee.name);
      if (feeRes.fee.unit === 'PER_DAY') {
        // Bills across the order's rental days (or an explicit override).
        effectiveRateType = 'DAILY';
        effectiveQuantity = 1;
        if (days == null) {
          return NextResponse.json(
            { error: "invalid fee", reason: "A per-day fee needs order dates (or explicit billableDays)." },
            { status: 400 },
          );
        }
      } else {
        // One-shot: the multiplier is the quantity (count/miles/gallons),
        // never the day span the line inherits from the order window.
        effectiveRateType = 'FLAT';
        days = 1;
        if (feeRes.fee.unit === 'PERCENT') effectiveQuantity = 1;
        if (!Number.isFinite(effectiveQuantity) || effectiveQuantity < 1) {
          return NextResponse.json(
            { error: "invalid fee", reason: "Quantity (count / hours / miles / gallons) must be a positive whole number." },
            { status: 400 },
          );
        }
        effectiveQuantity = Math.floor(effectiveQuantity);
      }
    } else {
      // Negotiated weekly rate (Wes 2026-09-05): when the account has a
      // weekly deal on this item and the rental runs past the department's
      // billing week, the line goes on the WEEKLY rate — the paper then
      // says "$580/wk (weekly rate)" instead of a derived per-day figure
      // that reads as their day rate. Only when the caller left the rate
      // type to us and is asking for the deal price (list or company
      // daily); an explicit rate type or a hand-typed override is theirs.
      let clientRate = rate;
      // Rental days INCLUSIVE of both ends (Sep 1 → Sep 11 is 11 days),
      // matching estimateRentalDays and RW's billable-period count —
      // calendarDays() measures the gap and would call it 10.
      const calDays = Math.max(1, Math.round((returnResolved.getTime() - pickupResolved.getTime()) / 86400000) + 1);
      if (body.rateType === undefined && (inventoryItemId || assetCategoryId)
        && weeklyRateApplies(resolvedDepartment, calDays)) {
        // The weekly must be the COMPANY's negotiated week, read off their
        // rate card directly — resolveRate merges in the catalog weekly for
        // a company row that only set a daily, and list weeklies are not a
        // deal anyone struck.
        const catalogId = inventoryItemId || (assetCategoryId ? await catalogIdForAssetCategory(assetCategoryId) : null);
        const card = catalogId
          ? await prisma.companyRate.findUnique({
              where: { companyId_inventoryItemId: { companyId: orderForGate.companyId, inventoryItemId: catalogId } },
              select: { dailyRate: true, weeklyRate: true },
            })
          : null;
        const weekly = card?.weeklyRate && card.weeklyRate.greaterThan(0) ? card.weeklyRate : null;
        if (weekly) {
          const deal = await resolveRate({
            inventoryItemId: inventoryItemId || null,
            assetCategoryId: assetCategoryId || null,
            companyId: orderForGate.companyId,
          });
          const asked = new Prisma.Decimal(String(rate ?? 0));
          if (deal.dailyRate == null || asked.equals(deal.dailyRate) || asked.equals(weekly)) {
            effectiveRateType = 'WEEKLY';
            clientRate = weekly.toString();
            // A weekly rate buys a billing week of `cap` days; unless the
            // rep set billableDays by hand, bill the capped count rather
            // than every calendar day (RW: 11 days → 9 billable periods).
            const cap = weeklyRateCap(resolvedDepartment);
            if (cap && (billableDays == null || Number(billableDays) <= 0)) {
              days = computeBillableDays(calDays, cap);
            }
          }
        }
      }
      rateResolution = await resolveLineRate({
        inventoryItemId: inventoryItemId || null,
        assetCategoryId: assetCategoryId || null,
        rateType: effectiveRateType,
        clientRate,
        isPackageMember: !!(packageInstanceId && !isPackageHeader),
        companyId: orderForGate.companyId,
      });
    }
    if (!rateResolution) {
      return NextResponse.json({ error: "invalid rate" }, { status: 400 });
    }

    // computeLineTotal returns 0 when days is NULL — see billing.ts.
    const lineTotal = computeLineTotal({
      quantity: effectiveQuantity,
      rate: rateResolution.rate.toNumber(),
      billableDays: days,
      rateType: effectiveRateType,
      department: resolvedDepartment,
    });

    // Seed the client-facing note from InventoryItem.clientNote when
    // the caller hasn't passed an explicit notes value. Lets the
    // catalog carry per-item policy text (e.g. LED Wall A/V Tech
    // requirement) that prints on every quote/invoice automatically;
    // rep can still override per-line via the row edit form.
    let seededNotes: string | null = notes ?? null;
    if (seededNotes == null && inventoryItemId) {
      const invForNote = await prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        select: { clientNote: true },
      });
      if (invForNote?.clientNote && invForNote.clientNote.trim().length > 0) {
        seededNotes = invForNote.clientNote;
      }
    }

    const lineItem = await prisma.orderLineItem.create({
      data: {
        orderId, sortOrder,
        type: effectiveType,
        description: effectiveDescription,
        inventoryItemId: inventoryItemId || null,
        assetCategoryId: assetCategoryId || null,
        feeItemId: feeItemId || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        pickupDate: pickupResolved,
        returnDate: returnResolved,
        rateType: effectiveRateType,
        rate: rateResolution.rate,
        resolvedRate: rateResolution.resolvedRate,
        rateOverridden: rateResolution.rateOverridden,
        quantity: effectiveQuantity,
        billableDays: days,
        // Shoot-days authority (Wes ruling B): computedDays is the
        // server-derived reference; claimedDays is the client's
        // REQUEST (eligible gear/vehicle lines only) and lands
        // PENDING — it never prices anything until an agent writes
        // billableDays via the day-claims endpoint.
        computedDays: computeDays(pickupResolved, returnResolved),
        ...(() => {
          const claim = sanitizeClaimedDays(claimedDays)
          const eligible = isClaimEligible({ type: effectiveType, department: resolvedDepartment })
          return claim != null && eligible
            ? { claimedDays: claim, claimStatus: 'PENDING' as const }
            : {}
        })(),
        lineTotal: Math.round(lineTotal * 100) / 100,
        notes: seededNotes,
        department: resolvedDepartment,
        ...(qualifier !== undefined ? { qualifier: qualifier || null } : {}),
        packageInstanceId: packageInstanceId || null,
        packageId: packageId || null,
        isPackageHeader: !!isPackageHeader,
        isPackageModified: !!isPackageModified,
      },
      include: {
        inventoryItem: { select: { id: true, code: true, description: true } },

        feeItem: { select: { id: true, code: true, name: true, unit: true } },
      },
    });

    // Rate-override audit row. Non-fatal (matches the route's other
    // audit writes) — the durable marker is rateOverridden on the row.
    if (rateResolution.rateOverridden && rateResolution.resolvedRate) {
      try {
        await logRateOverride(prisma, {
          orderId,
          orderLineItemId: lineItem.id,
          resolvedRate: rateResolution.resolvedRate,
          overrideRate: rateResolution.rate,
          rateType: effectiveRateType,
          userId: await resolveOperatorId(session.user.email),
          ipAddress: extractIp(req),
        });
      } catch (err) {
        console.error('[pricing] rate-override audit failed:', err instanceof Error ? err.message : err);
      }
    }

    // (#3a) PickList sync — fires regardless of order status. Reuses
    // bookOrder's routeDepartment so the lane/pickStatus assignment
    // is byte-identical to what the original book transition stamps.
    // For WAREHOUSE-routed lines, ensures a PickListItem exists; for
    // FLEET/STAGE, only stamps the lane. Three timing cases all
    // collapsed to "append no matter what" — even a sandbag added
    // after the list is LOADED gets a PENDING_PICK item appended for
    // the warehouse team to handle physically. The PickList state
    // is preserved — we never silently rewind to PICKING.
    // Fee lines are money-only: no fulfillment lane, no PickListItem —
    // a "Delivery Fee" must never appear on the warehouse picking floor.
    // (bookOrder skips type=FEE for the same reason.)
    const pickSync = lineItem.type === 'FEE'
      ? { lane: null, pickStatus: null, pickListAction: 'skipped-fee' as const }
      : await syncPickListOnLineAdd(prisma, {
          orderId,
          orderLineItemId: lineItem.id,
          department: resolvedDepartment,
        });

    // (#2 Phase 2) Holds sync — VEHICLES / STAGES only, gated on
    // Booking + assetCategoryId. Feasibility was checked above; here
    // we just write the BookingItem. Override note (when set) gets
    // appended to BookingItem.notes so dispatch's booking-detail view
    // shows the override without a separate query.
    let holdsResult: { bookingItemId: string; quantityBefore: number; quantityAfter: number; created: boolean } | null = null;
    // A vehicle on a quote is held THE MOMENT IT IS QUOTED (Wes
    // 2026-09-01: "if a vehicle is quoted with no hold, create one
    // immediately"). The hold used to wait for the quote to be SENT,
    // so a draft could carry a truck that read free on the board and
    // get promised to someone else. Idempotent + non-fatal; it also
    // mints the Booking this order had none of.
    if (wantsHoldSync && !parentBookingId) {
      const raised = await holdOnQuoteSend(orderId);
      if (raised.error) {
        console.error('[line-items] immediate hold failed:', raised.error);
      } else {
        // Rank follows approval + paperwork, never the mere existence
        // of the line.
        await reconcileHoldFirmness(orderId);
      }
    }
    if (wantsHoldSync && parentBookingId && holdCategoryId) {
      holdsResult = await syncHoldOnLineAdd(prisma, {
        bookingId: parentBookingId,
        categoryId: holdCategoryId,
        addedQty: Number(quantity),
        conflictOverrideNote: holdsOverrideNote,
      });
      // Dispatch-visible AuditLog row when the rep overrode a capacity
      // conflict. Distinct from the order.line_item_added row — this
      // lets dispatch filter by `booking_item.conflict_override` and
      // see every override in one query.
      if (holdsOverrideNote) {
        try {
          await prisma.auditLog.create({
            data: {
              userId: (await resolveOperatorId(session.user.email)) ?? null,
              ipAddress: extractIp(req),
              action: 'booking_item.conflict_override',
              entityType: 'BookingItem',
              entityId: holdsResult.bookingItemId,
              oldValues: { conflicts: holdsCoTenancy.map((c) => ({
                bookingNumber: c.bookingNumber,
                jobName: c.jobName,
                quantity: c.quantity,
                status: c.status,
              })) },
              newValues: {
                orderId,
                orderLineItemId: lineItem.id,
                quantityBefore: holdsResult.quantityBefore,
                quantityAfter: holdsResult.quantityAfter,
                note: holdsOverrideNote,
              },
            },
          });
        } catch (err) {
          console.error('[holds] override audit failed:', err instanceof Error ? err.message : err);
        }
      }
    }

    // The UNIT, right after the class (Wes 2026-09-10: "assigning next
    // available unit but agent could reassign the vehicle later"). A hold
    // is a category line that shows on no unit row; this binds a truck to
    // it so the reservation is real on the board the moment the line
    // exists. Vehicles only — a stage hold's rooms are picked on the
    // stage side. Non-fatal: the line and the hold stand either way.
    let unitOutcome: UnitAssignmentOutcome | null = null;
    if (wantsHoldSync && holdCategoryId && resolvedDepartment === 'VEHICLES') {
      unitOutcome = await assignUnitsForLine({
        orderId,
        categoryId: holdCategoryId,
        quantity: Number(quantity),
        request: parseUnitAssignment(unitAssignment),
        categoryLabel: effectiveDescription,
      });
    }

    // Included accessories. Adding 12 walkies owes a charging bank and
    // spare batteries whether the rep typed the line by hand or the AI
    // parsed it off an email — before this ran here, only the parsed
    // path knew. Runs BEFORE recalc so a CHARGED piece lands in the
    // totals it changed. Noop (one indexed query) when the item has no
    // kit, which is almost every item.
    const kitSync = await syncOrderKitPieces(prisma, orderId);

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
          feeItemId: lineItem.feeItemId,
          packageHeader: !!lineItem.isPackageHeader,
          packageMember: !!(lineItem.packageInstanceId && !lineItem.isPackageHeader),
          // (#3a) Record the PickList sync outcome on the audit row
          // so "what happened on the warehouse side?" is one query.
          fulfillmentLane: pickSync.lane,
          pickStatus: pickSync.pickStatus,
          pickListAction: pickSync.pickListAction,
          kitPiecesAdded: kitSync.created.map((k) => `${k.quantity} × ${k.description}`),
          kitPiecesResized: kitSync.resized.map((k) => `${k.description} ${k.from}→${k.to}`),
        },
        userId: operatorId,
        ipAddress: extractIp(req),
      });
    }

    // ── A partner unit: create the booking behind the line ──────────────
    //
    // bindToOrderLine.ts documents two ways a SubRental comes into being, and
    // only one of them knows a line. This is that one: the link is set at
    // CREATION and is therefore always right. It matters beyond bookkeeping —
    // every LCDW path asks `line.subRentals.length > 0` to decide whether a
    // vehicle is ours to insure, so an unlinked partner unit reads as a SirReel
    // vehicle and HQ offers a waiver on a coach we do not own.
    //
    // ESTIMATED, not REQUESTED: putting a unit on a quote is a pitch. The
    // partner is told their calendar is being shown (that mail is sent by the
    // quote flow, not here) and nothing is held until the client accepts.
    let subRental: { id: string; vendorId: string } | null = null;
    if (subcontractedVehicleId) {
      const unit = await prisma.subcontractedVehicle.findFirst({
        where: { id: subcontractedVehicleId, isActive: true, offeredToSirReel: true },
        select: { id: true, name: true, vendorId: true, listDailyRate: true, listWeeklyRate: true },
      });
      if (unit) {
        subRental = await prisma.subRental.create({
          data: {
            vendorId: unit.vendorId,
            subcontractedVehicleId: unit.id,
            orderId,
            orderLineItemId: lineItem.id,
            jobId: (await prisma.order.findUnique({ where: { id: orderId }, select: { jobId: true } }))?.jobId ?? null,
            itemDescription: unit.name,
            quantity: lineItem.quantity,
            startDate: lineItem.startDate,
            endDate: lineItem.endDate,
            status: "ESTIMATED",
            // What the CLIENT is billed, mirrored from the line so the
            // partner-side numbers can be stamped later without re-deriving
            // it (partnerShare.stampVendorCost fills the vendor side).
            clientDailyRate: lineItem.rate,
          },
          select: { id: true, vendorId: true },
        });
      }
    }

    await syncOrderWindowSafe(orderId);

    return NextResponse.json({
      lineItem,
      // Present only when the line is a partner unit — the UI says so rather
      // than silently booking somebody else's calendar.
      subRental,
      totals,
      // Included accessories that appeared or resized because of this
      // add. The UI announces them — a $0 line the rep did not type
      // reads as a bug when it shows up unannounced.
      kit: kitSync.noop ? null : kitSync,
      // Which unit(s) the line landed on, or why none did. Null when the
      // line is not a held vehicle. The UI says it out loud — a truck
      // bound without a word is how the rep double-checks on the board.
      unitAssignment: unitOutcome,
      // (#2 Phase 2) Holds outcome — null when not hold-tracked or no
      // Booking. coTenancy is informational only — the rep saw who
      // they share the category with but didn't need to confirm
      // (capacity was available); when capacity was NOT clear and
      // the rep confirmed, `overrideStamped` is true.
      holds: wantsHoldSync && parentBookingId && holdsResult
        ? {
            bookingItemId: holdsResult.bookingItemId,
            quantityBefore: holdsResult.quantityBefore,
            quantityAfter: holdsResult.quantityAfter,
            created: holdsResult.created,
            overrideStamped: holdsOverrideNote != null,
            coTenancy: holdsCoTenancy.map((c) => ({
              bookingNumber: c.bookingNumber,
              jobName: c.jobName,
              startDate: c.startDate.toISOString().slice(0, 10),
              endDate: c.endDate.toISOString().slice(0, 10),
              quantity: c.quantity,
              status: c.status,
            })),
            availability: holdsAvailability,
          }
        : null,
    }, { status: 201 });
  } catch (error) {
    console.error("Add line item error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
