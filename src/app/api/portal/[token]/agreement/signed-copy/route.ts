import { NextRequest, NextResponse } from 'next/server'
import { get } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { resolveAgreementToken } from '@/lib/portal/agreementToken'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/[token]/agreement/signed-copy
 *
 * Streams the signed PDF back to the client (so they can save their own copy).
 * Only available once the agreement has reached SIGNED_BASELINE or
 * SIGNED_NEGOTIATED.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const resolved = await resolveAgreementToken(params.token)
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })
  }

  const agreement = await prisma.signedAgreement.findUnique({
    where: { orderId_contractType: { orderId: resolved.order.id, contractType: 'RENTAL_AGREEMENT' } },
    select: { status: true, signedDocumentUrl: true },
  })
  if (!agreement) {
    return NextResponse.json({ error: 'Agreement not initialized' }, { status: 404 })
  }
  if (
    agreement.status !== 'SIGNED_BASELINE' &&
    agreement.status !== 'SIGNED_NEGOTIATED'
  ) {
    return NextResponse.json(
      { error: 'No signed copy available in current state', currentStatus: agreement.status },
      { status: 409 },
    )
  }
  if (!agreement.signedDocumentUrl) {
    return NextResponse.json({ error: 'Signed document missing' }, { status: 500 })
  }

  // signedDocumentUrl is the full Vercel Blob URL; extract the pathname as the
  // key for `get()` to fetch the private blob with current credentials.
  let blobKey = agreement.signedDocumentUrl
  try {
    const u = new URL(agreement.signedDocumentUrl)
    blobKey = u.pathname.replace(/^\//, '')
  } catch {
    // fall through and try as-is
  }

  try {
    const blob = await get(blobKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: 'Signed PDF not retrievable' }, { status: 502 })
    }

    const headers = new Headers()
    headers.set('Content-Type', blob.blob.contentType || 'application/pdf')
    headers.set('Content-Disposition', `attachment; filename="sirreel-signed-agreement.pdf"`)
    if (blob.blob.size != null) headers.set('Content-Length', String(blob.blob.size))
    headers.set('Cache-Control', 'no-store')
    return new NextResponse(blob.stream, { status: 200, headers })
  } catch (err) {
    console.error('[portal/agreement/signed-copy] fetch failed:', err)
    return NextResponse.json({ error: 'Failed to fetch signed PDF' }, { status: 500 })
  }
}
