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
  // Same restoration as the rental agreement above: these pointed at
  // /stage-contract, a REVIEW page with no way to sign. All three are live
  // and signable in Cognito.
  '/studiocontract': 'https://www.cognitoforms.com/SirReel/StudioContract',
  '/dluxeventcontract': 'https://www.cognitoforms.com/SirReel/DluxEventContract',
  '/dluxeventcontractannual': 'https://www.cognitoforms.com/SirReel/DluxEventContractAnnual',
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

  // ── Crew/ops forms recovered in the 2026-08-26 sweep ──
  // Every one of these was a live Wix page that 404'd after the DNS
  // cutover. Cognito destinations verified by fetching each and matching
  // the <title> (same bar as the block above): "Incident Report",
  // "Check Log", "Order Issue", "Order Ticket", "Loss Returns",
  // "Submit for Payment", "Employment Application", "Stage Hold Form",
  // "Wire/ACH Log".
  '/incidentreport': 'https://www.cognitoforms.com/sirreel/incidentreport',
  '/checklog': 'https://www.cognitoforms.com/sirreel/checklog',
  '/orderissue': 'https://www.cognitoforms.com/sirreel/orderissue',
  '/orderticket': 'https://www.cognitoforms.com/sirreel/orderticket',
  '/lossreturns': 'https://www.cognitoforms.com/sirreel/lossreturns',
  '/submitforpayment': 'https://www.cognitoforms.com/sirreel/submitforpayment',
  // Wix path carries hyphens; the Cognito form name does not.
  '/stage-hold-form': 'https://www.cognitoforms.com/sirreel/stageholdform',
  '/wireachlog': 'https://www.cognitoforms.com/sirreel/wireachlog',
  // Was on the "let it go" list below purely because nobody had found the
  // Cognito URL. It exists, so the reason for excluding it is gone.
  '/employmentapplication': 'https://www.cognitoforms.com/sirreel/employmentapplication',
  // No Cognito form — the banking details the old page published now live
  // behind the request form on the new site.
  '/achwireinfo': '/payment-info',

  // ── Contract/agreement aliases ──
  // Same restoration reasoning as '/rentalagreement' and '/studiocontract'
  // above: these are SIGNING entry points, so they go to Cognito, not to
  // the review pages. The "-pdf" variants were download links, and the
  // review page is where the current PDF lives, so those go internal.
  '/rental-agreement-online': 'https://www.cognitoforms.com/SirReel/RentalAgreement',
  '/rental-agreement-pdf': '/rental-agreement',
  '/stage-contract-online': 'https://www.cognitoforms.com/SirReel/StudioContract',
  '/stage-contract-pdf': '/stage-contract',
  '/stagecontract': 'https://www.cognitoforms.com/SirReel/StudioContract',
  '/standingsetscontract': 'https://www.cognitoforms.com/SirReel/StudioContract',
  '/csi-stage-contracts': 'https://www.cognitoforms.com/SirReel/StudioContract',
  '/dlux-event-contract-online': 'https://www.cognitoforms.com/SirReel/DluxEventContract',

  // Short card-auth aliases Wix published. Covered by the same reasoning
  // as '/creditcardauthorization' above — reviving a URL that already
  // existed, not opening a new door. If that policy tightens, these three
  // lines go together.
  '/cc': 'https://www.cognitoforms.com/SirReel/CreditCardAuthorization',
  '/cc-auth': 'https://www.cognitoforms.com/SirReel/CreditCardAuthorization',

  // ── More vehicles (slugs checked against VehicleCategory.slug) ──
  '/cube': '/vehicles/cube-truck',
  '/popvans': '/vehicles/popvan',
  '/proscout': '/vehicles/video-van-proscout',
  '/passvans': '/vehicles/15-passenger-van',
  '/cubes-cargos': '/vehicles',
  '/trailers': '/vehicles',

  // ── Gear/supply pages → the order form ──
  '/gear': '/order/supplies',
  '/grip': '/order/supplies',
  '/shop': '/order/supplies',
  '/supplies': '/order/supplies',
  '/expendables-and-swag': '/order/supplies',
  '/production-supplies-pdf': '/order/supplies',
  '/electric-rentals': '/order/supplies',

  // ── More studios ──
  '/lankershimstudios': '/stages',
  '/lankershim-calender': '/stages',   // Wix's spelling, kept verbatim
  '/studio-calendars': '/stages',
  '/csi': '/stages',
  '/lima': '/stages',
  '/chestnut': '/stages',
  '/safesets2': '/stages',
  '/safesetsold': '/stages',
  '/blog/categories/csi-stage-at-lankershim-studios': '/stages',

  // ── Misc ──
  '/contact-us': '/contact',
  '/book-now': '/contact',
  '/book-online': '/contact',
  '/book-online/availability': '/contact',
  '/clients': '/home',
  '/services': '/home',
  '/thanks': '/home',
  '/blog-1': '/home',
  '/news/tags/fleet': '/home',
  '/news/tags/office': '/home',
  '/news/tags/vehicles': '/home',
  '/post/set-walls-in': '/home',
  '/post/the-beginning': '/home',

  // DELIBERATELY ABSENT — confirmed dead, left to 404 rather than
  // redirected, so they drop out of Google's index instead of lingering:
  //   /minted, /minted-add-invoice, /minted-add-job, /minted-order,
  //   /member-admin, /copy-of-add-invoice, /copy-of-minted-newjob
  //
  // ALSO DELIBERATELY ABSENT — Wes's call (Aug 2026) to let these go rather
  // than chase down a Cognito URL for each. They 404 on cutover:
  //   /lockbox /liftgateinstructions /pickupwindow /paperwork
  //   /healthsafetyprotocols /membershiprewardsprogramagreement
  // (/employmentapplication left this list on 2026-08-26 — the Cognito form
  // turned out to exist, so the reason for excluding it was gone.)
  //
  // STILL OPEN after the 2026-08-26 sweep — the four MAP pages:
  //   /vehiclemap /vehiclemap-victory /lankershimmap /limamap
  // Recoverable PDFs exist in the Wix store, but "PARKING MAP" is the only
  // one whose title identifies it and three more are image-only with no
  // extractable text. Sending a driver to the wrong lot's map is worse than
  // a 404, so these stay dead until someone matches file to page by eye.
  // Same for /sample-coi (two candidate certificate PDFs) and /aicp.
  //
  // Left dead on purpose, no action needed: the old internal app's routes
  // (/createjob /createorder /createaccount /createcompany /job-builder
  // /job-reports /orders /new-job /jobs /document-1 /links-dashboard
  // /inbox /internal /members /account/my-account, /driverAvailability/*,
  // /repaircenter/*) and the per-unit repair pages (/srx /spoc /sr36 /solo
  // /sololine /x6 /stryker). Same policy as /minted above.
}

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
