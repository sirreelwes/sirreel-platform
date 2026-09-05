/** POST /api/sub-rentals/vehicles/[id]/rate-proposal — staff accept or
 *  decline a partner's proposed rates. Body: { decision: 'accept' | 'decline' } */
import { NextRequest, NextResponse } from 'next/server'
import { requireSubRentalStaff } from '@/lib/sub-rentals/staffGate'
import { resolveRateProposal } from '@/lib/sub-rentals/vendorAccountActions'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireSubRentalStaff(); if ('error' in g) return g.error
  const b = (await req.json().catch(() => ({}))) as { decision?: unknown }
  if (b.decision !== 'accept' && b.decision !== 'decline') return NextResponse.json({ error: 'decision must be accept or decline' }, { status: 400 })
  try {
    await resolveRateProposal(params.id, b.decision)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: (e as { status?: number }).status ?? 500 })
  }
}
