import { NextRequest, NextResponse } from "next/server";
import type { OrderStatus } from "@prisma/client";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { recalcOrderTotals } from "@/lib/orders";
import { computeQuoteStatusSync } from "@/lib/orders/quoteStatus";
import { ensureSignedAgreementForOrder } from "@/lib/orders/signedAgreement";
import { transitionCadenceState, rebaselineCadenceForOrder } from "@/lib/cadence/scheduler";
import { projectCadenceFromOrderStatus } from "@/lib/orders/cadenceProjection";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      company: true,
      agent: { select: { id: true, name: true, email: true } },
      booking: {
        select: {
          id: true, bookingNumber: true, jobName: true, productionName: true,
          // Drives the "Resend portal link" button's pre-flight enabled
          // state on the order detail page. Endpoint-side gates already
          // 409 when paperworkRequests is empty; surfacing the count
          // here lets the UI disable the button + show a tooltip
          // BEFORE the rep clicks (rather than after the fact).
          _count: { select: { paperworkRequests: true } },
        },
      },
      jobContact: { select: { id: true, firstName: true, lastName: true, email: true } },
      // Job's full contact roster — drives the "Will send to" recipient
      // display + multi-recipient tooltip on the Order detail page.
      job: {
        select: {
          id: true,
          jobCode: true,
          name: true,
          jobContacts: {
            select: {
              role: true,
              isPrimary: true,
              person: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
          },
        },
      },
      lineItems: {
        include: {
          inventoryItem: { select: { id: true, code: true, description: true, internalFlags: true } },
          assetCategory: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
      invoices: {
        orderBy: { createdAt: "desc" },
        include: {
          // Surface any InsuranceClaim attached to an LD invoice on
          // this order — drives the "Claim" chip in the order
          // detail header, linking to /claims/[id]. One claim per
          // LD invoice (enforced by openLdClaim); the array shape
          // accommodates future relaxation without a reader change.
          insuranceClaims: {
            select: { id: true, claimNumber: true, carrierClaimNumber: true, status: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      },
      // Per-send delivery audit — drives the small status pills on the
      // order's email/cadence rows. Each row is one Resend dispatch
      // (sent → delivered / delayed / bounced / complained). Cap at
      // 50 to keep the payload sane; the order page only needs the
      // most recent in any practical case.
      emailDeliveries: {
        select: {
          id: true,
          resendMessageId: true,
          status: true,
          statusDetail: true,
          statusAt: true,
          toAddress: true,
          subject: true,
          label: true,
          sentAt: true,
        },
        orderBy: { sentAt: "desc" },
        take: 50,
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json(order);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;

  // Session-required for mutations. All in-app callers run from the
  // (dashboard) shell so they have a session; this guard hardens the
  // route + locks down the blind-handoff capture per the brief.
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      status, description, startDate, endDate, taxRate, notes, companyId, agentId, bookingId,
      blindPickup, blindReturn, blindPickupInstructions, blindReturnInstructions,
    } = body;

    const data: Record<string, unknown> = {};
    // Capture the prior status so post-update cadence projection only
    // fires when status actually changed — projection itself is monotonic
    // (won't regress, won't fire on no-op), but skipping the call on
    // unchanged-status writes saves a DB roundtrip.
    let priorStatus: OrderStatus | null = null;
    if (status !== undefined) {
      data.status = status;
      // Phase 1 sales pipeline: keep quoteStatus in lockstep with status
      // and stamp the sales-stage timestamps on first transition.
      const current = await prisma.order.findUnique({
        where: { id },
        select: { status: true, sentAt: true, wonAt: true, lostAt: true },
      });
      if (current) {
        priorStatus = current.status;
        const sync = computeQuoteStatusSync(status as OrderStatus, current);
        Object.assign(data, sync);
      }
    }
    if (description !== undefined) data.description = description;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;

    // Inverted-range guard. Read the existing row when only one side
    // is being patched so we validate the EFFECTIVE pair, not just
    // what the rep typed in this request. Without this, every
    // downstream line-items helper silently floors to days=1.
    if (startDate !== undefined || endDate !== undefined) {
      const existingOrder = await prisma.order.findUnique({
        where: { id },
        select: { startDate: true, endDate: true },
      });
      const effectiveStart =
        startDate !== undefined
          ? (startDate ? new Date(startDate) : null)
          : existingOrder?.startDate ?? null;
      const effectiveEnd =
        endDate !== undefined
          ? (endDate ? new Date(endDate) : null)
          : existingOrder?.endDate ?? null;
      if (
        effectiveStart &&
        effectiveEnd &&
        effectiveEnd.getTime() < effectiveStart.getTime()
      ) {
        return NextResponse.json(
          {
            error: "invalid date range",
            reason: `Order end date (${effectiveEnd.toISOString().slice(0, 10)}) is before start date (${effectiveStart.toISOString().slice(0, 10)}).`,
          },
          { status: 400 },
        );
      }
    }
    if (taxRate !== undefined) data.taxRate = taxRate;
    if (notes !== undefined) data.notes = notes;
    if (companyId !== undefined) data.companyId = companyId;
    if (agentId !== undefined) data.agentId = agentId;
    if (bookingId !== undefined) data.bookingId = bookingId || null;
    // Blind handoff capture. Toggles and their free-text instructions
    // travel together; clearing a toggle is allowed but we don't auto-
    // null the instructions in that case — agent may turn the toggle
    // off temporarily without losing the text they typed.
    if (blindPickup !== undefined) data.blindPickup = !!blindPickup;
    if (blindReturn !== undefined) data.blindReturn = !!blindReturn;
    if (blindPickupInstructions !== undefined) {
      data.blindPickupInstructions = blindPickupInstructions || null;
    }
    if (blindReturnInstructions !== undefined) {
      data.blindReturnInstructions = blindReturnInstructions || null;
    }

    const order = await prisma.order.update({
      where: { id },
      data,
      include: {
        company: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
      },
    });

    if (taxRate !== undefined) {
      await recalcOrderTotals(id);
    }

    if ((data as { quoteStatus?: unknown }).quoteStatus === 'SENT') {
      await ensureSignedAgreementForOrder(id);
      // CRH Phase 2.2: kick off the SILENT cadence ladder when a quote goes
      // out. transitionCadenceState is idempotent — clearing-and-rescheduling
      // means repeated saves of the same SENT status don't duplicate events.
      try {
        await transitionCadenceState(id, 'QUOTE_SENT');
      } catch (err) {
        console.error('[orders/PUT] cadence schedule failed:', err);
      }
    }

    // Project cadence on ANY status transition — not just QUOTE_SENT.
    // Without this, manually flipping an order to ON_JOB / RETURNED /
    // INVOICED / CLOSED / CANCELLED via the order detail page bypassed
    // the cadence ladder entirely: the pickup-day reminder, return-day
    // reminder, completion thank-you, etc. cron events never got
    // scheduled. The bookOrder service already calls this helper
    // post-transaction; symmetrical here for every other transition.
    // Helper is monotonic + idempotent + guards against regressing past
    // LOST/CANCELLED, so a no-op write doesn't double-schedule.
    if (status !== undefined && priorStatus !== null && status !== priorStatus) {
      try {
        await projectCadenceFromOrderStatus(id, status as OrderStatus);
      } catch (err) {
        console.error('[orders/PUT] cadence projection failed:', err);
      }
    }

    // If pickup/return dates moved, re-baseline the cadence so all future
    // unfired events use the new timing. Per CRH brief §13.
    if (startDate !== undefined || endDate !== undefined) {
      try {
        await rebaselineCadenceForOrder(id);
      } catch (err) {
        console.error('[orders/PUT] cadence rebaseline failed:', err);
      }
    }

    // Thank-you suggestion trigger. Mints a SUGGESTED row when the
    // order's lifecycle transitions to RETURNED. Idempotent via the
    // unique orderId FK — a RETURNED → not-RETURNED → RETURNED bounce
    // does not double-mint. Never auto-sends; the human reviews and
    // sends through the standard preview/send gate.
    if (
      status !== undefined
      && priorStatus !== null
      && status !== priorStatus
      && status === 'RETURNED'
    ) {
      try {
        await prisma.thankYouSuggestion.upsert({
          where: { orderId: id },
          create: { orderId: id },
          update: {},
        });
      } catch (err) {
        console.error('[orders/PUT] thank-you suggestion mint failed:', err);
      }
    }

    return NextResponse.json(order);
  } catch (error) {
    console.error("Update order error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  // Session-required mutation (CLAUDE.md hard rule). DRAFT delete is
  // a one-shot teardown used by the order-detail "Delete draft"
  // button on /orders/[id], so we gate it the same way the rest of
  // the route does.
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Only DRAFT orders can be deleted" },
      { status: 400 }
    );
  }

  // Cascade is wired on the schema: Order.delete sweeps OrderLineItem
  // (2646), PickList (2790), PickListItem (via PickList 2812 + line
  // 2813), OrderDiscount (2741), and Booking-side BookingItem rows
  // ride their own Booking lifecycle (DRAFT orders never have a
  // Booking attached). No bespoke teardown needed.
  await prisma.order.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
