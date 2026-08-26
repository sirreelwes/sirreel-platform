/**
 * Legacy Wix URL map — DATA ONLY, in CommonJS.
 *
 * This lives in .js rather than .ts because next.config.js has to require it:
 * these paths are emitted as real next.config `redirects()` entries with
 * permanent: true, which Next evaluates BEFORE middleware (verified in
 * next/dist/server/lib/router-utils/resolve-routes.js — fsChecker.redirects
 * precedes the middleware entry in the route array). That ordering is what
 * makes a config-level redirect beat the marketing host's allow-list 404.
 *
 * legacyRedirects.ts imports this same object, so middleware still resolves
 * the map too. That is deliberate belt-and-braces, and it is NOT redundant:
 * next.config `source` patterns are case-sensitive, while the middleware
 * resolver lowercases and strips trailing slashes. The config entries handle
 * the canonical lowercase form; middleware catches /SuperCubeTruck and
 * /popvan/ on the way past.
 *
 * Everything below this header is the original map, moved verbatim — the
 * comments record real decisions (which Cognito URL is live, what was
 * deliberately left to 404) and are the only place several of them exist.
 */

const LEGACY_REDIRECTS = {
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
  // Bare '/' rather than '/home': the apex root is the canonical homepage
  // (middleware rewrites '/' → '/home' internally, and /home's own metadata
  // declares canonical '/'). Pointing these at /home sent an indexed Wix URL
  // to the non-canonical twin and made Google take a second hop to find it.
  '/home2': '/',
  '/copy-of-home-1': '/',

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

module.exports = { LEGACY_REDIRECTS }
