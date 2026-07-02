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
const ORDERS_HOST = 'orders.sirreel.com'

// Paths reachable on the public supply-order host. Root is rewritten to the
// form; everything else outside this list 404s so no gated/admin surface is
// ever exposed on orders.sirreel.com. The form is fully public (no auth) and
// calls only /api/public/* (catalog, vehicle-categories, supply-request).
const ORDERS_ALLOWED_PREFIXES = [
  '/order/supplies',   // the public supply form itself (rewrite target + direct hits)
  '/vehicles',         // public vehicle catalog: /vehicles + /vehicles/[slug]
  '/api/public/',      // catalog / vehicle-categories / supply-request
  '/_next/',           // Next.js build assets
  '/_vercel/',         // Vercel insights
  '/favicon',
  '/sirreel-logo',
  '/s-logo',
  '/full-logo',
  '/public/',
  '/api/health',
]

// Paths that are allowed on the portal host. Everything else 404s.
// Order matters: most-specific prefixes first.
const PORTAL_ALLOWED_PREFIXES = [
  '/portal/',          // every client-facing portal page
  '/api/portal/',      // every portal API route
  '/client/',          // legacy /client/[token] route (sibling to /portal/[token])
  '/client-login',     // client magic-link login page (posts to /api/client/auth)
  '/api/client/',      // legacy client API
  '/coi/',             // no-login client COI upload (/coi/[token])
  '/api/coi/',         // COI upload / download / link API (endpoints self-gate auth)
  '/api/cardpointe/',  // portal pay-panel CardPointe config (client payment iframe)
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

function tagged(res: NextResponse, host: string, action: string): NextResponse {
  // Debug header so the host-routing decision is observable in
  // response headers (vs invisible inside the closed Vercel runtime).
  // Cheap and harmless on prod — clients never inspect headers.
  res.headers.set('x-mw-host', host || 'unknown')
  res.headers.set('x-mw-action', action)
  // Disable CDN caching so the middleware decision is always live.
  // Without this, Vercel's edge serves PRERENDER cache for static
  // pages and bypasses middleware on subsequent hits.
  res.headers.set('cache-control', 'private, no-store, max-age=0, must-revalidate')
  return res
}

export function middleware(req: NextRequest): NextResponse {
  const host = (req.headers.get('host') || '').toLowerCase()
  const pathname = req.nextUrl.pathname

  // Local / preview — no host routing.
  if (isLocalHost(host)) return tagged(NextResponse.next(), host, 'pass:local')

  // ── orders.sirreel.com (public supply-order form) ─────────────
  if (host === ORDERS_HOST) {
    // Root → render the public supply form WITHOUT login. Rewrite (not
    // redirect) so the URL stays a clean bare orders.sirreel.com.
    if (pathname === '/' || pathname === '') {
      const url = req.nextUrl.clone()
      url.pathname = '/order/supplies'
      return tagged(NextResponse.rewrite(url), host, 'orders:root-rewrite')
    }
    // Portal paths (e.g. the form header's "Sign in" → /portal/auth/sign-in)
    // bounce to the canonical portal host — keeps the link working without
    // exposing portal surfaces on the orders host.
    if (
      pathname.startsWith('/portal/') ||
      pathname.startsWith('/api/portal/') ||
      pathname.startsWith('/client/') ||
      pathname.startsWith('/api/client/')
    ) {
      const url = req.nextUrl.clone()
      url.host = PORTAL_HOST
      url.protocol = 'https:'
      url.port = ''
      return tagged(NextResponse.redirect(url, 308), host, 'orders:portal-redirect')
    }
    // Allow the form + its public API + assets; 404 everything else so no
    // gated/admin route is reachable on this host.
    const allowed = ORDERS_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))
    if (allowed) return tagged(NextResponse.next(), host, 'orders:allow')
    return tagged(new NextResponse('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }), host, 'orders:block-404')
  }

  // ── tsx.sirreel.com (client portal) ───────────────────────────
  if (host === PORTAL_HOST) {
    // Root → portal sign-in (better than a bare 404; client may have
    // typed the domain directly).
    if (pathname === '/' || pathname === '') {
      const url = req.nextUrl.clone()
      url.pathname = PORTAL_ROOT_DESTINATION
      return tagged(NextResponse.redirect(url, 307), host, 'tsx:root-redirect')
    }
    // Allow-list portal + utility paths.
    const allowed = PORTAL_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))
    if (allowed) return tagged(NextResponse.next(), host, 'tsx:allow')
    // Everything else (staff dashboard / admin / crm / orders / etc.)
    // → 404. Critical: a client must NEVER see a staff login on tsx.
    return tagged(new NextResponse('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }), host, 'tsx:block-404')
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
      return tagged(NextResponse.redirect(url, 308), host, 'hq:portal-redirect')
    }
    return tagged(NextResponse.next(), host, 'hq:pass')
  }

  // Unknown host — pass through (defensive default; could 404 here
  // but we don't want to surprise anyone hitting the project via a
  // future hostname before we've thought about it).
  return tagged(NextResponse.next(), host, 'pass:unknown-host')
}

/**
 * Match every non-internal request. The middleware itself short-
 * circuits hosts it doesn't care about — letting Next handle the
 * matcher this broadly means fewer surprises when new path prefixes
 * appear.
 *
 * Note: the matcher format requires path-to-regexp syntax. Earlier
 * version used a single negative-lookahead pattern that worked
 * locally but produced confusing edge-cache behavior on Vercel for
 * statically-rendered pages — the SSG output was served from the
 * PRERENDER cache without re-running middleware. The explicit
 * regex array below makes the intent unambiguous to Next's compiler
 * and avoids the lookahead path through which Vercel was bypassing
 * middleware for pre-rendered static routes.
 */
export const config = {
  matcher: [
    // Match every path. The internal exclusions handled by the
    // function body via early-returns are cheaper than complex
    // matcher regexes and easier to read.
    '/:path*',
  ],
}
