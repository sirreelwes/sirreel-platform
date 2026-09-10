/** POST /api/vendors/[id]/share-proposal — staff accept or decline a partner's
 *  proposed split. Body: { decision: 'accept' | 'decline' }
 *
 *  Accepting returns agreementNeedsRefiling: the split prints in the Terms box
 *  on page one of the filed agreement (vendorAgreementTerms), so a signed one
 *  now states a deal that is no longer the deal. The panel says so. */
import { NextRequest, NextResponse } from 'next/server'
import { requireSubRentalStaff } from '@/lib/sub-rentals/staffGate'
import { resolveShareProposal } from '@/lib/sub-rentals/vendorAccountActions'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireSubRentalStaff(); if ('error' in g) return g.error
  const b = (await req.json().catch(() => ({}))) as { decision?: unknown }
  if (b.decision !== 'accept' && b.decision !== 'decline') return NextResponse.json({ error: 'decision must be accept or decline' }, { status: 400 })
  try {
    const r = await resolveShareProposal(params.id, b.decision)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: (e as { status?: number }).status ?? 500 })
  }
}
