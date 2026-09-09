/**
 * POST /api/crm/companies/[id]/agreements/offer-annual — file the annual
 * rental agreement for signature in the client's account portal.
 *
 * Creates the pending master (unsigned, NOT covering) — see
 * src/lib/portal/companyAnnual.ts. Terms-editor allowlist, like every other
 * change to a client's paper.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireCompanyTermsEditor } from '@/lib/portal/companyTermsEditors'
import { offerAnnualForSignature, findPendingAnnual } from '@/lib/portal/companyAnnual'
import { findOpenAnnualRequest, resolveAnnualRequests } from '@/lib/portal/annualRequest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireCompanyTermsEditor()
  if ('error' in g) return g.error
  // The client's own ask, when there is one — so the panel can say who
  // asked and when, right beside the button that answers it.
  const [pending, request] = await Promise.all([
    findPendingAnnual(params.id),
    findOpenAnnualRequest(params.id),
  ])
  return NextResponse.json({
    ok: true,
    pending,
    request: request
      ? {
          requestedAt: request.createdAt.toISOString(),
          requestedByName: request.requestedByName,
          source: request.source,
        }
      : null,
  })
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireCompanyTermsEditor()
  if ('error' in g) return g.error
  try {
    const pending = await offerAnnualForSignature(params.id, { byUserId: g.user.id })
    // Filing the annual IS the answer to the ask — close it here rather
    // than leaving the desk a queue row that outlived its reason.
    await resolveAnnualRequests({
      companyId: params.id,
      reason: 'OFFERED',
      byUserId: g.user.id,
    })
    return NextResponse.json({ ok: true, pending })
  } catch (e) {
    console.error('[offer-annual] failed:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
