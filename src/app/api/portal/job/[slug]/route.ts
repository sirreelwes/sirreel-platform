import { NextRequest, NextResponse } from 'next/server'
import { resolveJobMagicLink } from '@/lib/portal/jobMagicLink'
import {
  buildJobSessionCookieHeader,
  createJobSessionCookieValue,
} from '@/lib/portal/jobSession'

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
