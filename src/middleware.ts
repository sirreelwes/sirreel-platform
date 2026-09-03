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
import { resolveLegacyRedirect } from '@/lib/site/legacyRedirects'

const STAFF_HOST = 'hq.sirreel.com'
const PORTAL_HOST = 'tsx.sirreel.com'
const ORDERS_HOST = 'orders.sirreel.com'
// Marketing site (apex + www). LIVE — DNS points both at Vercel (confirmed
// 2026-08-26: each answers `server: Vercel` and takes the root-rewrite
// branch below). This comment used to read "inert until DNS points these at
// Vercel", which cost real time diagnosing a client-facing 404: the cutover
// had happened, so the allow-list below was already the thing deciding what
// clients could reach, and every Wix /_files/ document URL was 404ing.
// Anything missing from PUBLIC_SITE_ALLOWED_PREFIXES is dead in production
// right now, not hypothetically after some future DNS change.
const PUBLIC_HOSTS = ['sirreel.com', 'www.sirreel.com']

// Public marketing surface allow-list — Home + the public catalog +
// the order form + assets. Everything else (staff/portal/admin) 404s.
const PUBLIC_SITE_ALLOWED_PREFIXES = [
  '/home',
  '/contact',
  '/help',             // public help hub — after-hours assistant + how-to videos
  '/vehicles',
  '/stages',           // public stages/studios pages (STUDIOS nav + home tiles)
  '/standing-sets',    // public standing-sets pages (STUDIOS nav + home tiles)
  '/payment-info',     // public "request payment info" page (FORMS → Billing)
  // Payment-details share link (/pay-details/[token]). MUST be allowed here,
  // not only on the portal host: the payment-info request form lives on this
  // host, and the email builds its link from the requesting origin — so a
  // share minted from sirreel.com points at sirreel.com. Allow-listing it on
  // the portal host alone sent every one of those recipients to the branded
  // 404, and the API worked, which made it look like a content problem
  // rather than a routing one.
  '/pay-details/',
  '/rental-agreement', // public agreement review page (FORMS → Rental Agreement)
  '/stage-contract',   // public stage-contract review page (FORMS → Studio Contract)
  // UNLISTED unit page (/unit/[token]) — a client-facing page for a vehicle we
  // do not publish in the catalog. Linked from nowhere and noindex, but it must
  // resolve on the host the estimate email points at, which is this one. It is
  // an allow-list entry, not a listing: nothing here advertises the path, and
  // without a valid 32-byte token the route 404s.
  '/unit/',
  // Vendor's view of a sub-rental (/vendor/[token]) — same unlisted,
  // token-is-the-credential contract as /unit/, for the other side of the deal.
  '/vendor/',
  '/order/supplies',
  '/api/public/',
  '/_next/',
  '/_vercel/',
  '/favicon',
  '/icon-',            // icon-192.png / icon-512.png (PWA + Android tab icons)
  '/apple-touch-icon',
  '/sirreel-logo',
  '/s-logo',
  '/full-logo',
  '/images/',          // static marketing images (stages heroes, etc.)
  '/guides/',          // client gear setup PDFs linked from /help/[slug]
  '/site-404',         // branded-404 rewrite target; listed so a rewrite that
                       // ever re-entered middleware can't bounce forever
  '/public/',
  '/api/health',
  // Outreach unsubscribe landing. MUST be reachable with no session and
  // no cookie — the person clicking is a stranger holding a signed link,
  // and an unsubscribe that asks anyone to log in is not an unsubscribe.
  '/unsubscribe',
  // SEO surface. Without these the crawler gets a 404 for the very
  // sitemap robots.txt advertises.
  '/robots.txt',
  '/sitemap.xml',
]

// Paths reachable on the public supply-order host. Root is rewritten to the
// form; everything else outside this list 404s so no gated/admin surface is
// ever exposed on orders.sirreel.com. The form is fully public (no auth) and
// calls only /api/public/* (catalog, vehicle-categories, supply-request).
const ORDERS_ALLOWED_PREFIXES = [
  '/order/supplies',   // the public supply form itself (rewrite target + direct hits)
  '/home',             // public Home page (linked from the shared public nav)
  '/contact',          // public contact band (nav Contact + quote/payment deep-links)
  '/help',             // public help hub — after-hours assistant + how-to videos
  '/vehicles',         // public vehicle catalog: /vehicles + /vehicles/[slug]
  '/stages',           // public stages/studios pages (STUDIOS nav + home tiles)
  '/standing-sets',    // public standing-sets pages (STUDIOS nav + home tiles)
  '/payment-info',     // public "request payment info" page (FORMS → Billing)
  '/rental-agreement', // public agreement review page (FORMS → Rental Agreement)
  '/stage-contract',   // public stage-contract review page (FORMS → Studio Contract)
  '/api/public/',      // catalog / vehicle-categories / supply-request
  '/_next/',           // Next.js build assets
  '/_vercel/',         // Vercel insights
  '/favicon',
  '/icon-',            // icon-192.png / icon-512.png (PWA + Android tab icons)
  '/apple-touch-icon',
  '/sirreel-logo',
  '/s-logo',
  '/full-logo',
  '/images/',          // static marketing images (stages heroes, etc.)
  '/guides/',          // client gear setup PDFs linked from /help/[slug]
  '/site-404',         // branded-404 rewrite target; listed so a rewrite that
                       // ever re-entered middleware can't bounce forever
  '/public/',
  '/api/health',
  // SEO surface. Without these the crawler gets a 404 for the very
  // sitemap robots.txt advertises.
  '/robots.txt',
  '/sitemap.xml',
]

// Paths that are allowed on the portal host. Everything else 404s.
// Order matters: most-specific prefixes first.
const PORTAL_ALLOWED_PREFIXES = [
  '/unsubscribe',      // outreach unsubscribe — allowed on the client host too,
                       // since that is where client-facing links point
  '/portal/',          // every client-facing portal page
  '/api/portal/',      // every portal API route
  '/client/',          // legacy /client/[token] route (sibling to /portal/[token])
  '/client-login',     // client magic-link login page (posts to /api/client/auth)
  '/api/client/',      // legacy client API
  '/pay-details/',     // A/P payment-details share link (/pay-details/[token])
  '/unit/',            // unlisted subcontracted-unit page (/unit/[token])
  '/vendor/',          // partner's view of a sub-rental (/vendor/[token])
  '/coi/',             // no-login client COI upload (/coi/[token])
  '/api/coi/',         // COI upload / download / link API (endpoints self-gate auth)
  '/driver/',          // no-login driver licence upload (/driver/[token])
  '/api/driver-portal/', // driver portal read + licence upload (token-gated)
  '/drive/',           // no-login driver JOB page (/drive/[token])
  '/api/drive/',       // driver job page data + licence upload (token-gated)
  // After-hours instructions forwarded by the CLIENT to their truck driver
  // or PA (/after-hours/[token]). Same token-is-the-credential contract as
  // /drive/ above, and a narrower payload — one page, no portal session, no
  // order, no pricing. It MUST resolve here: the share email is client-
  // facing mail and every client-facing link is built on this host.
  '/after-hours/',
  '/api/after-hours/', // the share's read (token-gated, self-checks)
  '/api/cardpointe/',  // portal pay-panel CardPointe config (client payment iframe)
  '/intake/',          // public agent-shared intake forms (/intake + /intake/[slug])
  '/api/intake/',      // intake submit
  '/api/public/',      // public supply-request, etc.
  '/order/supplies',   // public supply-ordering surface
  '/_next/',           // Next.js build assets
  '/_vercel/',         // Vercel insights
  '/favicon',          // /favicon.ico + any favicon-* variant
  '/apple-touch-icon', // home-screen icon (iOS fetches this path directly)
  '/sirreel-logo',     // logos referenced by inline-image emails
  '/s-logo',           // ditto
  '/full-logo',        // ditto
  '/public/',          // static files
  '/api/health',       // upstream probe (if/when one exists)
  // robots.txt MUST be reachable here. It was missing, so tsx.sirreel.com
  // answered 404 for it — and a crawler that gets a 404 for robots.txt
  // treats the host as fully crawlable. Portal pages are token-gated, so
  // no content leaked, but a forwarded or pasted tokenised URL was
  // eligible for indexing. robots.ts is host-keyed and already returns
  // "Disallow: /" for every non-marketing host; it just never ran.
  // sitemap.xml is deliberately NOT listed — nothing here should be
  // crawled, so there is nothing to advertise.
  '/robots.txt',
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

/**
 * Branded 404 for the client-facing hosts. Rewrites to the /site-404 trigger,
 * which calls notFound() and renders (public)/not-found.tsx inside the public
 * shell with a real 404 status.
 *
 * These hosts previously returned literal `new NextResponse('Not found')` —
 * unstyled text on a white page. That is the destination for anyone following
 * one of the 15 deliberately-unmapped legacy Wix URLs, so it should look like
 * SirReel rather than a broken server.
 *
 * The portal host (tsx) deliberately keeps the bare text 404: it is a
 * token-gated surface with nothing to browse to, and marketing chrome there
 * would invite poking around.
 */
function branded404(req: NextRequest, host: string, action: string): NextResponse {
  const url = req.nextUrl.clone()
  url.pathname = '/site-404'
  url.search = ''
  return tagged(NextResponse.rewrite(url), host, action)
}

export function middleware(req: NextRequest): NextResponse {
  const host = (req.headers.get('host') || '').toLowerCase()
  const pathname = req.nextUrl.pathname

  // ── Legacy Wix URLs ───────────────────────────────────────────
  // FIRST, before host routing and before the local-dev pass-through, so
  // (a) an indexed Wix link can't be swallowed by the marketing host's
  // catch-all 404, and (b) the map is testable on localhost.
  // These paths exist nowhere in the app, so matching every host is safe
  // and means staff typing /fuelcardlog at hq.sirreel.com also land right.
  const legacy = resolveLegacyRedirect(pathname)
  if (legacy) {
    // Resolve against the current origin so an internal destination may carry
    // its own query string (/order/supplies?category=radios-wifi). Assigning
    // to .pathname instead would URL-encode the "?" into the path.
    const dest = legacy.startsWith('http')
      ? new URL(legacy)
      : new URL(legacy, req.nextUrl.origin)
    // 308 permanent — Google transfers the old page's ranking to the new one.
    return tagged(NextResponse.redirect(dest, 308), host, 'legacy:redirect')
  }

  // Local / preview — no host routing.
  if (isLocalHost(host)) return tagged(NextResponse.next(), host, 'pass:local')

  // ── sirreel.com / www.sirreel.com (public marketing site) ─────
  if (PUBLIC_HOSTS.includes(host)) {
    // www → apex, permanently. Also declared in next.config.js redirects();
    // it is duplicated here on purpose because the execution order between
    // next.config redirects and middleware is the exact subtlety called out
    // in legacyRedirects.ts, and if middleware ran first the config rule
    // would never fire and www would keep serving a full second copy of the
    // site. Both layers send the same 308 to the same place, so whichever
    // wins the result is identical and no loop is possible — the destination
    // host is the apex, which matches neither rule.
    if (host === 'www.sirreel.com') {
      const url = req.nextUrl.clone()
      url.host = 'sirreel.com'
      url.protocol = 'https:'
      url.port = ''
      return tagged(NextResponse.redirect(url, 308), host, 'public:www-to-apex')
    }
    // Root → the Home page. Rewrite (not redirect) so the URL stays
    // a clean bare sirreel.com.
    if (pathname === '/' || pathname === '') {
      const url = req.nextUrl.clone()
      url.pathname = '/home'
      return tagged(NextResponse.rewrite(url), host, 'public:root-rewrite')
    }
    // Portal links (order form header "Sign in") bounce to the portal host.
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
      return tagged(NextResponse.redirect(url, 308), host, 'public:portal-redirect')
    }
    const allowed = PUBLIC_SITE_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))
    if (allowed) return tagged(NextResponse.next(), host, 'public:allow')
    return branded404(req, host, 'public:block-404')
  }

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
    return branded404(req, host, 'orders:block-404')
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
      // A driver link pasted with the hq host would otherwise hit the
      // staff app and demand a Google login the driver doesn't have.
      pathname.startsWith('/driver/') ||
      pathname.startsWith('/api/driver-portal/') ||
      pathname.startsWith('/drive/') ||
      pathname.startsWith('/api/drive/') ||
      // Same problem as /drive/ above: an after-hours share link pasted or
      // forwarded with the hq host would hit the staff app and demand a
      // Google login from a truck driver at 5am.
      pathname.startsWith('/after-hours/') ||
      pathname.startsWith('/api/after-hours/') ||
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
