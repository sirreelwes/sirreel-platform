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
  '/jobmemo': 'https://www.cognitoforms.com/sirreel/jobmemo',
  '/vehicledamagereport': 'https://www.cognitoforms.com/sirreel/vehicledamagereport',
  // Wix path is the un-suffixed name; the LIVE Cognito form is the "2".
  // Both URLs resolve, so this mapping is the only thing recording which
  // one is current — don't "tidy" the 2 away.
  '/vehiclerepairreport': 'https://www.cognitoforms.com/sirreel/vehiclerepairreport2',

  // The bare "reimbursements" form is GONE (404) — only the "2" exists, so
  // unlike vehiclerepairreport there is no fallback if the suffix is edited.
  '/reimbursements': 'https://www.cognitoforms.com/sirreel/reimbursements2',
  // Preserves a URL Wix already published. Note this reintroduces a
  // card-authorization entry point that PUBLIC_NAV deliberately omits (see
  // publicNav.ts: card data lives in CardPointe, SirReel never stores it).
  // Redirecting an existing link is status quo, not a new capability — but
  // if the policy is meant to cover this URL too, drop this line.
  '/creditcardauthorization': 'https://www.cognitoforms.com/SirReel/CreditCardAuthorization',

  // No Wix predecessor — new shortcuts at the form's own name, so these
  // work the same way as the rest once DNS moves.
  '/vehicleviolationbilled': 'https://www.cognitoforms.com/sirreel/vehicleviolationbilled',
  '/billedorderticket': 'https://www.cognitoforms.com/sirreel/billedorderticket',
  // Form is literally named "Order Return Report A"; both spellings mapped
  // so nobody has to remember the trailing letter.
  '/orderreturnreport': 'https://www.cognitoforms.com/sirreel/orderreturnreporta',
  '/orderreturnreporta': 'https://www.cognitoforms.com/sirreel/orderreturnreporta',

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
  //
  // RESTORED TO COGNITO. These pointed at /rental-agreement, which is a
  // REVIEW page — a client can read the clauses and download a PDF there,
  // but cannot sign. Signing was supposed to happen in the portal, and the
  // portal still tells the client "your rep will send the agreement
  // shortly". So between the Wix cutover and this line, anyone following a
  // rental-agreement link had no way to actually sign one.
  //
  // Points back at Cognito until portal self-signing is live. The review
  // page keeps its own URL (/rental-agreement) and its nav entry.
  '/rentalagreement': 'https://www.cognitoforms.com/SirReel/RentalAgreement',
  '/annualrentalagreement': 'https://www.cognitoforms.com/SirReel/AnnualRentalAgreement',
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

  // ── Vehicles / studios: best-guess mappings, easy to correct ──
  '/supercargovan': '/vehicles/cargo-van',
  '/scout': '/vehicles/video-van-proscout',
  '/proscoutinstructions': '/vehicles/video-van-proscout',
  '/dluxjobs': '/vehicles/dlux',
  '/clientlounges': '/stages',
  '/safesets': '/stages',
  '/studiophotos': '/stages',
  '/studioprojectinfo': '/stages',

  // Wix's "Communications" page → the walkies/wifi section of the order
  // form, which is what that page was actually selling.
  '/communications': '/order/supplies?category=radios-wifi',
  '/ambassador': '/contact',
  '/ar': '/rental-agreement',

  // ── SEO pages with no equivalent (Wes's call: redirect, don't rebuild) ──
  // Job-type landing pages go to the vehicle catalog rather than Home —
  // someone searching "cube truck for a music video" wants the offering,
  // not the brand page. Ranking for the specific phrasing is lost either
  // way; this at least lands them somewhere useful.
  '/jobs/feature-film': '/vehicles',
  '/jobs/commercial-production': '/vehicles',
  '/jobs/music-video': '/vehicles',
  '/jobs/short-film': '/vehicles',
  '/jobs/corporate': '/vehicles',
  '/news': '/home',
  '/news/categories/fleet': '/home',
  '/post/popvans-mobile-office-solution': '/vehicles/popvan',

  // DELIBERATELY ABSENT — confirmed dead, left to 404 rather than
  // redirected, so they drop out of Google's index instead of lingering:
  //   /minted, /minted-add-invoice, /minted-add-job, /minted-order,
  //   /member-admin, /copy-of-add-invoice, /copy-of-minted-newjob
  //
  // ALSO DELIBERATELY ABSENT — Wes's call (Aug 2026) to let these go rather
  // than chase down a Cognito URL for each. They 404 on cutover:
  //   /lockbox /liftgateinstructions /pickupwindow /vehiclemap /paperwork
  //   /employmentapplication /healthsafetyprotocols
  //   /membershiprewardsprogramagreement
  // If any turns out to still be in use, adding it here is a one-liner.
}

/** Resolve a pathname to its legacy destination, or null. Case/slash tolerant. */
export function resolveLegacyRedirect(pathname: string): string | null {
  const key = pathname.toLowerCase().replace(/\/+$/, '') || '/'
  return LEGACY_REDIRECTS[key] ?? null
}
