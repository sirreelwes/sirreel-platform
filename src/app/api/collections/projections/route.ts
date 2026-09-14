import { NextRequest, NextResponse } from 'next/server'
import { requireCollectionsUser } from '@/lib/collections/access'
import { buildCollectionsProjection, DEFAULT_LAG_DAYS } from '@/lib/collections/projections'

/**
 * GET /api/collections/projections — the weekly collections forecast.
 *
 * `?lag=N` sets the payment-lag ASSUMPTION in days (0-180). It is an
 * assumption rather than a measurement for reasons documented at length in
 * src/lib/collections/projections.ts; the UI exposes it as a control so the
 * person reading the forecast owns the number rather than inheriting a
 * plausible-looking default they cannot see.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const raw = req.nextUrl.searchParams.get('lag')
  const parsed = raw == null ? NaN : Number(raw)
  const lagDays = Number.isFinite(parsed) ? parsed : DEFAULT_LAG_DAYS

  const projection = await buildCollectionsProjection(new Date(), { lagDays })
  return NextResponse.json({ ok: true, ...projection })
}
