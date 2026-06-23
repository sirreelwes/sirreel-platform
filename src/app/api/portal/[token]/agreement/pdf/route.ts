/**
 * GET /api/portal/[token]/agreement/pdf
 *
 * Token-gated proxy for the rental agreement's `documentToSignUrl` PDF on
 * the external paperwork portal. The PDF lives in the PRIVATE Blob store
 * (negotiated/counter PDFs are `access:'private'`; the stage/standing
 * sweep flipped the rest), so the raw URL 403s in the client's browser —
 * and a session-gated proxy is no good here because the recipient has no
 * HQ session. Auth is the unguessable PaperworkRequest magic-link token in
 * the path, the same gate the rest of this portal uses.
 *
 * `documentToSignUrl` may reference the stage/standing baseline or a
 * contract-review counter PDF; this streams whichever it currently points
 * at via the shared `streamPrivateBlobAsResponse` helper.
 *
 * Consumers: the portal "Preview negotiated PDF" link and the
 * NEGOTIATED_READY review iframe on portal/[token]/page.tsx.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveAgreementToken } from '@/lib/portal/agreementToken'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const resolved = await resolveAgreementToken(params.token)
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })
  }

  const url = resolved.agreement?.documentToSignUrl
  if (!url) {
    return NextResponse.json({ error: 'No document available to sign yet' }, { status: 404 })
  }

  return streamPrivateBlobAsResponse({
    fileUrl: url,
    filename: `rental-agreement-${resolved.order.orderNumber}.pdf`,
  })
}
