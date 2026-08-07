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
 * Keys are lowercase, no trailing slash. Add to this map rather than putting
 * redirects in next.config.js — routing order between next.config redirects
 * and middleware is subtle, and the middleware's host branching (which 404s
 * anything not allow-listed) is the thing these have to beat.
 */

export const LEGACY_REDIRECTS: Record<string, string> = {
  // ── Operational forms → Cognito (bare form URLs, verified live) ──
  '/expenselog': 'https://www.cognitoforms.com/sirreel/expenselog',
  '/fuelcardlog': 'https://www.cognitoforms.com/sirreel/fuelcardlog',
  '/stagemanagerreport': 'https://www.cognitoforms.com/sirreel/stagemanagerreport',
  '/afterhours': 'https://www.cognitoforms.com/sirreel/afterhoursinstructions',
  // Wix had several vehicle-closing variants; all point at the one live form.
  '/vehicleclaimcloser': 'https://www.cognitoforms.com/sirreel/fleetvehicleclosingchecklist',
  '/vehiclerepaircloser': 'https://www.cognitoforms.com/sirreel/fleetvehicleclosingchecklist',

  // ── Vehicles → /vehicles/[slug] ──
  '/cameracubetruck': '/vehicles/camera-cube',
  '/supercubetruck': '/vehicles/supercube',
  '/supercargovanliftgate': '/vehicles/cargo-w-liftgate',
  '/popvan': '/vehicles/popvan',
  '/proscoutvideovan': '/vehicles/video-van-proscout',
  '/dlux': '/vehicles/dlux',

  // ── Studios ──
  '/studios': '/stages',
  '/standingsets': '/standing-sets',
  '/victorystudios': '/stages',

  // ── Forms / documents that DID move here ──
  '/rentalagreement': '/rental-agreement',
  '/annualrentalagreement': '/rental-agreement',
  '/rental-agreement-online-previous': '/rental-agreement',
  '/studiocontract': '/stage-contract',
  '/dluxeventcontract': '/stage-contract',
  '/dluxeventcontractannual': '/stage-contract',
  '/w9': '/api/public/forms/w9',
  '/coireview': '/api/public/forms/coi',

  // ── Ordering ──
  '/orderrequest': '/order/supplies',
  '/clientrequest': '/order/supplies',
  '/equipment': '/order/supplies',

  // ── Misc pages with a clear home on the new site ──
  '/chatbot': '/help',
  '/onlineaccount': '/help',
  '/home2': '/home',
  '/copy-of-home-1': '/home',
}

/** Resolve a pathname to its legacy destination, or null. Case/slash tolerant. */
export function resolveLegacyRedirect(pathname: string): string | null {
  const key = pathname.toLowerCase().replace(/\/+$/, '') || '/'
  return LEGACY_REDIRECTS[key] ?? null
}
