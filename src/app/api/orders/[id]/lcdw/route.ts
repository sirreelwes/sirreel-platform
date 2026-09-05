/**
 * GET    /api/orders/[id]/lcdw — what LCDW would cover on this order.
 * POST   /api/orders/[id]/lcdw — add the waiver line.
 * DELETE /api/orders/[id]/lcdw — remove it.
 *
 * Wes, 2026-08-29: "we need to have the option to add LCDW coverage on
 * all vehicles except Video Vans and PopVans."
 *
 * The pricing and the refusals live in src/lib/orders/applyLcdw.ts since
 * 2026-09-05, because the client's own election in the portal now applies
 * the fee too. This route is the rep-driven doorway onto the same helper —
 * one place prices the waiver, so the button and the portal can never
 * disagree about what it costs or what it covers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { describeLcdwCoverage } from '@/lib/pricing/lcdwEligibility'
import { applyLcdwToOrder, loadLcdwCoverage, removeLcdwFromOrder } from '@/lib/orders/applyLcdw'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const ctx = await loadLcdwCoverage(id)
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
  const result = await applyLcdwToOrder(id)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status })
  if (result.alreadyApplied) {
    return NextResponse.json({ ok: true, alreadyApplied: true, lineId: result.lineId })
  }
  return NextResponse.json({
    ok: true,
    lineId: result.lineId,
    vehicleDays: result.vehicleDays,
    perDay: result.perDay,
    total: result.total,
    summary: result.summary,
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const result = await removeLcdwFromOrder(id)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status })
  if (result.alreadyRemoved) return NextResponse.json({ ok: true, alreadyRemoved: true })
  return NextResponse.json({ ok: true, removed: result.removed })
}
