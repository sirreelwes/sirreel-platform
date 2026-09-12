import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveJobMagicLink } from '@/lib/portal/jobMagicLink'
import {
  buildJobSessionCookieHeader,
  createJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import {
  buildJobPreviewCookieHeader,
  createJobPreviewCookieValue,
  readJobPreviewToken,
} from '@/lib/portal/jobPreview'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/job/[slug]?token=<magicLinkToken>
 *
 * First-visit entry point for the Job Page portal. Validates the magic link
 * token against the slug, sets a 30-day signed session cookie, and returns
 * the minimal info the portal page needs to render. The cookie is
 * HttpOnly+Secure+SameSite=Lax; the session signature is verified
 * server-side on every protected request (see /api/portal/job/session).
 *
 * Returns 401 on any link validation failure. The response body is
 * intentionally minimal — the portal page makes follow-up authenticated
 * requests for job/equipment/paperwork data once the cookie is set.
 */
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const url = new URL(req.url)

  // ?preview=… — a staff member looking at this page, handed over from HQ
  // (jobPreview.ts). Same handshake as the client's: token in the URL, cookie
  // in the response, token stripped by the page. The cookie it sets is a
  // preview, not a session: no write route on this portal will accept it, and
  // nothing about the client's own link is touched.
  const previewToken = url.searchParams.get('preview') || ''
  if (previewToken) {
    const claim = readJobPreviewToken(previewToken)
    if (!claim) {
      return NextResponse.json({ error: 'This preview link has expired — open it again from the job page.' }, { status: 401 })
    }
    const order = await prisma.order.findUnique({
      where: { id: claim.orderId },
      select: { id: true, portalSlug: true, orderNumber: true, company: { select: { id: true, name: true } } },
    })
    if (!order || order.portalSlug !== params.slug) {
      return NextResponse.json({ error: 'That preview is for a different job.' }, { status: 401 })
    }
    const res = NextResponse.json({ ok: true, preview: { by: claim.by }, order: { id: order.id, orderNumber: order.orderNumber, company: order.company } })
    res.headers.append('Set-Cookie', buildJobPreviewCookieHeader(createJobPreviewCookieValue(order.id, claim.by)))
    return res
  }

  const token = url.searchParams.get('token') || ''
  const resolved = await resolveJobMagicLink({ slug: params.slug, token })
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })
  }

  let cookieValue: string
  try {
    cookieValue = createJobSessionCookieValue(resolved.portalAccessId)
  } catch (err) {
    console.error('[portal/job entry] could not sign session:', err)
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const res = NextResponse.json({
    ok: true,
    portalAccessId: resolved.portalAccessId,
    order: {
      id: resolved.order.id,
      orderNumber: resolved.order.orderNumber,
      company: resolved.order.company,
    },
    contact: resolved.contact,
  })
  res.headers.append('Set-Cookie', buildJobSessionCookieHeader(cookieValue))
  return res
}
