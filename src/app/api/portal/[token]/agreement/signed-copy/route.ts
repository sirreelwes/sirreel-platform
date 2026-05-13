import { NextRequest, NextResponse } from 'next/server'
import { resolveAgreementToken } from '@/lib/portal/agreementToken'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/[token]/agreement/signed-copy
 *
 * Streams the signed PDF back to the client (downloads their own copy).
 * Only valid after signedDocumentUrl is set. Stub: validates the token
 * and returns 501.
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
    { error: 'Not implemented', stub: true, orderId: resolved.order.id },
    { status: 501 },
  )
}
