import { NextRequest, NextResponse } from 'next/server'
import { resolveAgreementToken } from '@/lib/portal/agreementToken'

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/[token]/agreement/sign
 *
 * Captures the client's signature payload, audits IP/UA/acknowledgment,
 * generates the signed PDF, persists it to Vercel Blob, emails copies,
 * and transitions status to SIGNED_BASELINE or SIGNED_NEGOTIATED based on
 * documentType. Request body shape per feature brief:
 *
 *   { signerName, signerTitle, signerEmail,
 *     signatureImageData (base64 PNG), acknowledgmentText, acknowledged: true }
 *
 * Stub: validates the token and returns 501.
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
