import { NextRequest, NextResponse } from 'next/server'
import { resolveAgreementToken } from '@/lib/portal/agreementToken'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/[token]/agreement
 *
 * Returns the current state + allowed actions + document URLs for the
 * signing portal. See paperwork-portal-signing-feature-brief.md for the
 * full response shape. Stub: validates the token and returns 501 until
 * the full state-machine handler lands.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const resolved = await resolveAgreementToken(params.token)
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })
  }

  return NextResponse.json(
    {
      error: 'Not implemented',
      stub: true,
      orderId: resolved.order.id,
      agreementExists: !!resolved.agreement,
    },
    { status: 501 },
  )
}
