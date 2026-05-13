import { NextRequest, NextResponse } from 'next/server'
import { resolveAgreementToken } from '@/lib/portal/agreementToken'

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/[token]/agreement/upload-redline
 *
 * Path A continuation: accepts the client's redlined .docx or .pdf,
 * stores it in Vercel Blob, creates a ContractReview record linked to
 * the SignedAgreement, and transitions status DOWNLOAD_SENT →
 * REDLINE_UPLOADED. Stub: validates the token and returns 501.
 */
export async function POST(
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
