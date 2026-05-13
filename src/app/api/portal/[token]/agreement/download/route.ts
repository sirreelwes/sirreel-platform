import { NextRequest, NextResponse } from 'next/server'
import { resolveAgreementToken } from '@/lib/portal/agreementToken'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/[token]/agreement/download
 *
 * Path A start: generates a .docx of the rental agreement with job data
 * prefilled, streams it back, and transitions status from PORTAL_GENERATED
 * to DOWNLOAD_SENT. Stub: validates the token and returns 501.
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
