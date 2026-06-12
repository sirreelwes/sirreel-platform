/**
 * Host-based routing for the tsx.sirreel.com client portal split.
 *
 * Two production hostnames, served by the same Vercel project:
 *   - hq.sirreel.com   — staff dashboard. Portal paths here are
 *                        308-redirected to tsx so old email links
 *                        keep working forever.
 *   - tsx.sirreel.com  — client portal. Staff paths return 404 so
 *                        a client never accidentally sees an admin
 *                        login or dashboard surface.
 *
 * Local dev passes through unchanged — see src/lib/portal/portalUrl.ts
 * for the two-host spoof recipe (`/etc/hosts` entries) if you want
 * to exercise the split locally.
 *
 * Cookies stay host-only. The portal cookie set on tsx is NOT
 * available to hq (and vice versa) — STEP 0 of the splitoff brief
 * called this out as the desired separation. Clients re-auth once
 * during cutover via the magic-link email; not a blocker.
 *
 * Why a single root middleware: this is the first one in the
 * project. The Explore agent confirmed no pre-existing
 * middleware.ts. If one lands later, the host-routing block here
 * must run FIRST and either return its own NextResponse or fall
 * through to whatever the new middleware wants.
 */

import { NextRequest, NextResponse } from 'next/server'

const STAFF_HOST = 'hq.sirreel.com'
const PORTAL_HOST = 'tsx.sirreel.com'

// Paths that are allowed on the portal host. Everything else 404s.
// Order matters: most-specific prefixes first.
const PORTAL_ALLOWED_PREFIXES = [
  '/portal/',          // every client-facing portal page
  '/api/portal/',      // every portal API route
  '/client/',          // legacy /client/[token] route (sibling to /portal/[token])
  '/api/client/',      // legacy client API
  '/intake/',          // public agent-shared intake forms (/intake + /intake/[slug])
  '/api/intake/',      // intake submit
  '/api/public/',      // public supply-request, etc.
  '/order/supplies',   // public supply-ordering surface
  '/_next/',           // Next.js build assets
  '/_vercel/',         // Vercel insights
  '/favicon',          // /favicon.ico + any favicon-* variant
  '/sirreel-logo',     // logos referenced by inline-image emails
  '/s-logo',           // ditto
  '/full-logo',        // ditto
  '/public/',          // static files
  '/api/health',       // upstream probe (if/when one exists)
]

// Paths that explicitly redirect when hit on the portal host root.
const PORTAL_ROOT_DESTINATION = '/portal/auth/sign-in'

function isLocalHost(host: string): boolean {
  // Dev hostnames pass through with no rewrites — see portalUrl.ts
  // for the spoof setup.
  if (host.startsWith('localhost')) return true
  if (host.startsWith('127.')) return true
  if (host.startsWith('192.168.')) return true
  if (host.endsWith('.local')) return true        // tsx.local / hq.local /etc/hosts setup
  if (host.endsWith('.vercel.app')) return true   // preview deploys
  return false
}

export function middleware(req: NextRequest): NextResponse {
  const host = (req.headers.get('host') || '').toLowerCase()
  const pathname = req.nextUrl.pathname

  // Local / preview — no host routing.
  if (isLocalHost(host)) return NextResponse.next()

  // ── tsx.sirreel.com (client portal) ───────────────────────────
  if (host === PORTAL_HOST) {
    // Root → portal sign-in (better than a bare 404; client may have
    // typed the domain directly).
    if (pathname === '/' || pathname === '') {
      const url = req.nextUrl.clone()
      url.pathname = PORTAL_ROOT_DESTINATION
      return NextResponse.redirect(url, 307)
    }
    // Allow-list portal + utility paths.
    const allowed = PORTAL_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))
    if (allowed) return NextResponse.next()
    // Everything else (staff dashboard / admin / crm / orders / etc.)
    // → 404. Critical: a client must NEVER see a staff login on tsx.
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  // ── hq.sirreel.com (staff dashboard) ──────────────────────────
  if (host === STAFF_HOST) {
    // Portal paths on the staff host → 308 to tsx with the path
    // preserved. Old client emails with hq URLs still land on the
    // portal. 308 is "permanent + preserve method", so any POST /
    // PUT / DELETE the legacy URL might have carried also redirects
    // cleanly.
    if (
      pathname.startsWith('/portal/') ||
      pathname.startsWith('/api/portal/') ||
      pathname.startsWith('/client/') ||
      pathname.startsWith('/api/client/') ||
      pathname.startsWith('/intake/') ||
      pathname.startsWith('/api/intake/') ||
      pathname.startsWith('/order/supplies')
    ) {
      const url = req.nextUrl.clone()
      url.host = PORTAL_HOST
      url.protocol = 'https:'
      url.port = ''
      return NextResponse.redirect(url, 308)
    }
    return NextResponse.next()
  }

  // Unknown host — pass through (defensive default; could 404 here
  // but we don't want to surprise anyone hitting the project via a
  // future hostname before we've thought about it).
  return NextResponse.next()
}

/**
 * Match every request. The middleware itself short-circuits hosts
 * it doesn't care about — letting Next handle the matcher means
 * fewer surprises when new path prefixes appear.
 */
export const config = {
  matcher: [
    // Exclude only the Next image optimizer + the static directory's
    // image MIME paths from middleware processing. Everything else
    // goes through.
    '/((?!_next/image|_next/static|_vercel/insights).*)',
  ],
}
