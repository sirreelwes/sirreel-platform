import { NextRequest, NextResponse } from 'next/server'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'
import { lookupUnit } from '@/lib/warehouse/unitScans'

export const dynamic = 'force-dynamic'

/**
 * GET /api/warehouse/units/lookup?code=SR004674 — "where is this unit?"
 *
 * The register row (RW's description, serial, shelf, replacement cost)
 * plus HQ's own answer: the order it is open on, and its recent trips.
 * Yard staff only — the same people who scan it out.
 */
export async function GET(req: NextRequest) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response
  const code = new URL(req.url).searchParams.get('code') ?? ''
  if (!code.trim()) return NextResponse.json({ error: 'code is required' }, { status: 400 })
  return NextResponse.json(await lookupUnit(code))
}
