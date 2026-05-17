import { NextRequest, NextResponse } from 'next/server'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/job/session
 *
 * Cookie-authenticated session check. Returns 401 when the cookie is
 * missing, malformed, expired, or the underlying PortalAccess has been
 * revoked / the portal has sunset. Used by the portal client page to:
 *   - confirm a session is still good before fetching protected data
 *   - hydrate the visible contact/company/order display on page load
 */
export async function GET(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    // Cookie signature was valid but the row is gone / revoked. Clear the
    // stale cookie on the response so the client can re-magic-link.
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }
  return NextResponse.json({
    ok: true,
    portalAccessId: resolved.portalAccessId,
    order: {
      id: resolved.order.id,
      orderNumber: resolved.order.orderNumber,
      portalSlug: resolved.order.portalSlug,
      company: resolved.order.company,
    },
    contact: resolved.contact,
  })
}

/**
 * DELETE /api/portal/job/session — client-side logout. Just clears the
 * cookie; the PortalAccess row stays active so a fresh magic link can be
 * used to re-establish.
 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
  return res
}
