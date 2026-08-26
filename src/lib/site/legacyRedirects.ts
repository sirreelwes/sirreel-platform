/**
 * Legacy Wix URL map — every path the old sirreel.com published that people
 * have bookmarked or Google has indexed.
 *
 * The Wix sitemap listed 71 URLs. The new site has 13 page routes on entirely
 * different paths, so without this map every one of those would hit the
 * marketing host's bare-text 404 the moment DNS moves. These 308s keep the
 * links alive and hand Google the ranking for the pages that moved.
 *
 * Two kinds of destination:
 *   - internal  ('/vehicles/camera-cube') — the page genuinely moved here.
 *   - external  ('https://www.cognitoforms.com/...') — the operational forms
 *     never lived on Wix at all; those pages were thin wrappers around
 *     Cognito. Only the memorable URL needs preserving, not the form.
 *
 * COGNITO URLS MUST BE THE BARE FORM PATH. The `/1-all-entries` variant is the
 * admin entries view and 302s to a Cognito LOGIN page — a crew member on
 * location would hit an auth wall instead of the form. Verified by fetching
 * both: bare returns <title>Fuel Card Log</title>, /1-all-entries returns
 * <title>Cognito Forms: Free Online Form Builder</title> at /login.
 *
 * Applied on EVERY host (see middleware.ts), not just the marketing one:
 * these paths exist nowhere in the app, so they can't shadow a real route,
 * and staff who type them against hq.sirreel.com get where they're going too.
 *
 * Whole trees of old URLs (Wix's /_files/ document store, the /product-page/
 * shop) are handled by LEGACY_PREFIX_REDIRECTS below the map instead of by
 * one key each.
 *
 * Keys are lowercase, no trailing slash. Add new paths to the map in
 * legacyRedirects.data.js — next.config.js turns every entry into a real
 * `redirects()` rule, and this module keeps resolving the same object for
 * middleware, so one edit covers both.
 *
 * This header used to warn AGAINST next.config.js, on the theory that the
 * ordering was subtle and the middleware host branching (which 404s anything
 * not allow-listed) was the thing these had to beat. That was wrong, and the
 * check is cheap: in next/dist/server/lib/router-utils/resolve-routes.js the
 * route array is headers → redirects → middleware → rewrites, so a
 * next.config redirect is answered BEFORE middleware ever runs and the
 * allow-list never sees the request.
 */

// The map itself now lives in legacyRedirects.data.js (CommonJS) so that
// next.config.js can require it and emit every entry as a real
// `redirects()` rule with permanent: true. Re-exported here unchanged so
// middleware and every existing importer keep working.
//
// next.config's rules run BEFORE middleware, so in production these are
// what actually answer. This resolver stays as the case- and
// slash-tolerant safety net for variants the config sources can't match
// (/SuperCubeTruck, /popvan/).
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const LEGACY_REDIRECTS: Record<string, string> =
  require('./legacyRedirects.data.js').LEGACY_REDIRECTS

/**
 * Prefix rules — one entry standing in for a whole tree of old URLs, for the
 * cases where enumerating them in LEGACY_REDIRECTS is impossible or pointless.
 *
 * Checked only AFTER an exact-key miss, so a specific mapping always wins.
 */
const LEGACY_PREFIX_REDIRECTS: Array<{
  prefix: string
  /** Receives the path AFTER the prefix (never empty, no leading slash). */
  to: (tail: string) => string
}> = [
  {
    // Wix served every uploaded document from a domain-relative /_files/
    // path that proxied its CDN. Those files were NEVER part of this repo,
    // so after the DNS cutover each one became a hard 404 — the failure a
    // client hit on 2026-08-26 looking for the driver pickup sheet.
    //
    // The Wayback CDX index lists 42 such URLs (41 PDFs + 1 zip) and ALL 42
    // are still served by the CDN, so a passthrough revives every one at
    // once — including any never crawled and therefore never enumerated.
    // Content is unchanged: this is the exact origin Wix itself proxied.
    //
    // THE DEPENDENCY IS REAL: these files live in the Wix account, so
    // cancelling it breaks them again. Mirroring the 42 into public/ (~38MB)
    // removes that; until then, this file is the only record that a live
    // client-facing surface depends on a Wix subscription.
    prefix: '/_files/',
    to: (tail) => `https://static.wixstatic.com/${tail}`,
  },
  {
    // 63 Wix store product pages, all gear and expendables that the supply
    // order form now sells. Per-product mapping would be guesswork against
    // a catalog keyed differently; the form is the honest destination.
    prefix: '/product-page/',
    to: () => '/order/supplies',
  },
]

/** Resolve a pathname to its legacy destination, or null. Case/slash tolerant. */
export function resolveLegacyRedirect(pathname: string): string | null {
  const key = pathname.toLowerCase().replace(/\/+$/, '') || '/'
  const exact = LEGACY_REDIRECTS[key]
  if (exact) return exact

  for (const rule of LEGACY_PREFIX_REDIRECTS) {
    if (!key.startsWith(rule.prefix)) continue
    // Sliced from the ORIGINAL pathname, not the lowercased key: Wix asset
    // keys are case-sensitive on the CDN. Lowercasing doesn't change length,
    // so the offset is the same.
    const tail = pathname.slice(rule.prefix.length).replace(/^\/+/, '').replace(/\/+$/, '')
    // A bare "/_files" is a directory listing that never existed, and a
    // traversal tail is never legitimate — both fall through to the 404.
    if (!tail || tail.includes('..')) continue
    return rule.to(tail)
  }
  return null
}
