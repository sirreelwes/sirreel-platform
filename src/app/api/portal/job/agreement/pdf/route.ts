/**
 * GET /api/portal/job/agreement/pdf
 *   ?type=RENTAL_AGREEMENT|STAGE_CONTRACT   (default RENTAL_AGREEMENT)
 *   ?doc=tosign|signed                      (default tosign)
 *
 * Job-session-gated proxy for a SignedAgreement's PDF on the native portal
 * job pages. Cookie-auth'd sibling of /api/portal/[token]/agreement/pdf —
 * auth is the JOB_SESSION_COOKIE the browser sends with the same-origin
 * iframe/link, resolved to the order the client portal session is scoped to.
 *
 * `doc=tosign` serves `documentToSignUrl` (stage/standing baseline or
 * contract-review counter); `doc=signed` serves `signedDocumentUrl` (the
 * executed copy). Both are PRIVATE blobs that 403 in the client's browser;
 * this streams whichever the field points at via the shared
 * `streamPrivateBlobAsResponse` helper.
 *
 * Consumers: the rental + stage sign-page review iframes and the paperwork
 * "View pre-signed PDF" / "Download signed copy" links on the portal job
 * pages.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = new Set(['RENTAL_AGREEMENT', 'STAGE_CONTRACT'])

export async function GET(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
  }

  const typeParam = req.nextUrl.searchParams.get('type') || 'RENTAL_AGREEMENT'
  if (!ALLOWED_TYPES.has(typeParam)) {
    return NextResponse.json({ error: 'Invalid contract type' }, { status: 400 })
  }
  const contractType = typeParam as 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT'
  const wantSigned = req.nextUrl.searchParams.get('doc') === 'signed'

  const agreement = await prisma.signedAgreement.findUnique({
    where: { orderId_contractType: { orderId: resolved.orderId, contractType } },
    select: { documentToSignUrl: true, signedDocumentUrl: true },
  })
  const fileUrl = wantSigned ? agreement?.signedDocumentUrl : agreement?.documentToSignUrl
  if (!fileUrl) {
    return NextResponse.json({ error: 'No document available to sign yet' }, { status: 404 })
  }

  return streamPrivateBlobAsResponse({
    fileUrl,
    filename: `${contractType.toLowerCase()}${wantSigned ? '-signed' : ''}-${resolved.order.orderNumber}.pdf`,
  })
}
