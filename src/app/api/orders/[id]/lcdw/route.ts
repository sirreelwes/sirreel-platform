/**
 * GET    /api/orders/[id]/lcdw — what LCDW would cover on this order.
 * POST   /api/orders/[id]/lcdw — add the waiver line.
 * DELETE /api/orders/[id]/lcdw — remove it.
 *
 * Wes, 2026-08-29: "we need to have the option to add LCDW coverage on
 * all vehicles except Video Vans and PopVans."
 *
 * Eligibility is not decided here — it lives in
 * src/lib/pricing/lcdwEligibility.ts, which encodes the rule the RENTAL
 * AGREEMENT already states and every client signs. This route only
 * applies it and prices the result.
 *
 * ── The one thing this must never do ───────────────────────────────
 *
 * Charge for a vehicle the agreement excludes. A client who pays $24/day
 * believing their VideoVan is covered, and discovers at claim time that
 * the addendum excluded it, has been sold nothing — and found out in the
 * worst possible circumstance. So POST refuses outright when every
 * vehicle is excluded, and the response always reports what is NOT
 * covered alongside what is.
 *
 * Quantity is VEHICLE-DAYS (Σ qty × billable days across eligible lines
 * only), because the fee is per vehicle per day and the excluded ones
 * must not be in that sum.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import {
  quoteLcdw, describeLcdwCoverage, LCDW_FEE_CODE, type LcdwCandidate,
} from '@/lib/pricing/lcdwEligibility'
import { computeLineTotal } from '@/lib/orders/billing'

export const dynamic = 'force-dynamic'

async function loadCoverage(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, status: true, startDate: true, endDate: true,
      lineItems: {
        select: {
          id: true, description: true, department: true, quantity: true,
          billableDays: true, type: true, feeItemId: true,
          pickupDate: true, returnDate: true,
          inventoryItem: { select: { code: true } },
        },
      },
    },
  })
  if (!order) return null

  const candidates: LcdwCandidate[] = order.lineItems
    // Fee lines are charges, not vehicles — never judge them.
    .filter((l) => l.type !== 'FEE')
    .map((l) => ({
      id: l.id,
      description: l.description,
      code: l.inventoryItem?.code ?? null,
      department: l.department,
      quantity: l.quantity,
      billableDays: l.billableDays,
    }))

  const fee = await prisma.feeItem.findFirst({
    where: { code: LCDW_FEE_CODE, isActive: true },
    select: { id: true, amount: true, unit: true, name: true },
  })
  const existing = fee
    ? order.lineItems.find((l) => l.type === 'FEE' && l.feeItemId === fee.id)
    : undefined

  return { order, quote: quoteLcdw(candidates), fee, existing }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const ctx = await loadCoverage(id)
  if (!ctx) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const perDay = ctx.fee ? Number(ctx.fee.amount) : null
  return NextResponse.json({
    available: !!ctx.fee && ctx.quote.eligible.length > 0,
    applied: !!ctx.existing,
    perDay,
    vehicleDays: ctx.quote.vehicleDays,
    estimatedTotal: perDay !== null ? perDay * ctx.quote.vehicleDays : null,
    summary: describeLcdwCoverage(ctx.quote),
    eligible: ctx.quote.eligible,
    excluded: ctx.quote.excluded,
    allExcluded: ctx.quote.allExcluded,
    feeMissing: !ctx.fee,
  })
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const ctx = await loadCoverage(id)
  if (!ctx) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  if (!ctx.fee) {
    return NextResponse.json(
      { error: `No active "${LCDW_FEE_CODE}" fee in the catalog — add it under Admin → Fees first.` },
      { status: 409 },
    )
  }
  if (ctx.existing) {
    return NextResponse.json({ ok: true, alreadyApplied: true, lineId: ctx.existing.id })
  }
  if (ctx.quote.allExcluded) {
    return NextResponse.json(
      { error: describeLcdwCoverage(ctx.quote) },
      { status: 409 },
    )
  }
  if (ctx.quote.eligible.length === 0) {
    return NextResponse.json({ error: 'No vehicles on this order to cover.' }, { status: 409 })
  }
  if (ctx.quote.vehicleDays <= 0) {
    return NextResponse.json(
      { error: 'The eligible vehicles have no billable days yet — set dates first.' },
      { status: 409 },
    )
  }

  // Window = span of the covered vehicles, falling back to the order's.
  // Line dates are required on OrderLineItem, so a fee with no derivable
  // window is refused rather than written with a guessed date.
  const eligibleIds = new Set(ctx.quote.eligible.map((e) => e.id))
  const covered = ctx.order.lineItems.filter((l) => eligibleIds.has(l.id))
  const starts = covered.map((l) => l.pickupDate).filter(Boolean) as Date[]
  const ends = covered.map((l) => l.returnDate).filter(Boolean) as Date[]
  const coverageStart =
    starts.length > 0 ? new Date(Math.min(...starts.map((d) => d.getTime()))) : ctx.order.startDate
  const coverageEnd =
    ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : ctx.order.endDate
  if (!coverageStart || !coverageEnd) {
    return NextResponse.json(
      { error: 'The covered vehicles have no dates yet — set them before adding the waiver.' },
      { status: 409 },
    )
  }

  const perDay = Number(ctx.fee.amount)
  const maxSort = ctx.order.lineItems.length

  // Priced through the SAME helper every other line uses, rather than a
  // local qty × rate — the billing rules differ per department and a
  // second multiplication path is how totals quietly diverge.
  const lineTotal = computeLineTotal({
    department: 'VEHICLES',
    quantity: ctx.quote.vehicleDays,
    rate: perDay,
    billableDays: 1,
    rateType: 'FLAT',
  })

  const line = await prisma.orderLineItem.create({
    data: {
      orderId: ctx.order.id,
      type: 'FEE',
      department: 'VEHICLES',
      feeItemId: ctx.fee.id,
      lineTotal: Math.round(lineTotal * 100) / 100,
      // The waiver spans exactly the vehicles it covers, so its window
      // is their span — not the order's, which may reach wider for
      // gear that isn't covered.
      pickupDate: coverageStart,
      returnDate: coverageEnd,
      // The description carries the coverage on its face, so the client
      // reading the quote sees which vehicles it applies to without
      // having to reconcile it against the line items themselves.
      description:
        `Limited Collision Damage Waiver — ${ctx.quote.eligible.length} vehicle` +
        `${ctx.quote.eligible.length === 1 ? '' : 's'}` +
        (ctx.quote.excluded.length > 0
          ? ` (excludes ${ctx.quote.excluded.map((e) => e.description).join(', ')})`
          : ''),
      quantity: ctx.quote.vehicleDays,
      rate: perDay,
      billableDays: 1,
      rateType: 'FLAT',
      sortOrder: maxSort + 1,
    },
    select: { id: true },
  })

  return NextResponse.json({
    ok: true,
    lineId: line.id,
    vehicleDays: ctx.quote.vehicleDays,
    perDay,
    total: perDay * ctx.quote.vehicleDays,
    summary: describeLcdwCoverage(ctx.quote),
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const ctx = await loadCoverage(id)
  if (!ctx) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!ctx.existing) return NextResponse.json({ ok: true, alreadyRemoved: true })

  await prisma.orderLineItem.delete({ where: { id: ctx.existing.id } })
  return NextResponse.json({ ok: true, removed: ctx.existing.id })
}
