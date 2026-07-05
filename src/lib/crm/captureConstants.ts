/**
 * Constants for the CRM auto-capture pipeline.
 *
 * SALES_CAPTURE_INBOXES is the gated set — info@/jose@/oliver@ ONLY.
 * The capture helper refuses to run for anything else. Ana, claims,
 * hr, and the satellite inboxes (hello@/jobs@/studios@) are
 * deliberately excluded per the STEP 2 spec.
 *
 * HARD_SKIP_SENDER_PATTERNS catches automated mail by the local-part
 * of the From: address. These run BEFORE any AI signal and trump
 * every production-legitimacy heuristic.
 *
 * COLD_SOLICITATION_KEYWORDS is a small belt-and-suspenders layer on
 * top of Haiku's messageNature='solicitation' verdict — used when
 * extracted data is missing.
 */

export const SALES_CAPTURE_INBOXES: ReadonlySet<string> = new Set([
  'info@sirreel.com',
  'jose@sirreel.com',
  'oliver@sirreel.com',
])

export const SIRREEL_DOMAIN = 'sirreel.com'

// Bare-string match against the localpart (before @) of the From: addr.
// Case-insensitive; tested via `.includes()` so substrings count
// ("auto-noreply@..." matches "noreply").
export const HARD_SKIP_SENDER_PATTERNS: readonly string[] = [
  'no-reply',
  'noreply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'bounces',
  'bounce',
  'notifications',
  'notification',
  'auto-reply',
  'autoresponse',
  'auto-response',
  'do_not_reply',
]

// Cold sales / recruiting / lead-gen / SEO / financing pitches when
// the AI signal is missing. Substring match on subject + first 600
// chars of body, case-insensitive.
export const COLD_SOLICITATION_KEYWORDS: readonly string[] = [
  'introduce our services',
  'introduce ourselves',
  '15 minutes to chat',
  '15 minutes to introduce',
  'demo of our',
  'recurring revenue',
  'lead generation',
  'lead-gen',
  'seo audit',
  'we provide',
  'we represent',
  'recruiter',
  'staffing agency',
  'merchant cash advance',
  'business financing',
  'small business loan',
]

// Production-identity title tokens. Substring match against the
// extracted title field, case-insensitive. ONE match → production
// signal "a" (role title present).
//
// Coverage philosophy: every below-the-line department that touches
// vehicles/gear on a SirReel job is in scope. Wardrobe / HMU / art /
// props / locations / set dec are production roles even though they
// rarely say "production" in their titles — they are exactly the
// people booking us.
export const PRODUCTION_TITLE_TOKENS: readonly string[] = [
  // Producing
  'producer',
  'production manager',
  'production coordinator',
  'production supervisor',
  'production assistant',
  'upm',
  'unit production manager',
  'line producer',
  'executive producer',
  'showrunner',
  'producer/director',
  'co-producer',
  'co producer',
  'segment producer',
  'field producer',
  'commercial producer',
  // Camera / lighting / grip
  'gaffer',
  'key grip',
  'best boy',
  'dp ',
  'director of photography',
  'cinematographer',
  // AD / direction
  '1st ad',
  '2nd ad',
  'assistant director',
  // Art department
  'art director',
  'art coordinator',
  'art department',
  'art dept',
  'production designer',
  'set decorator',
  'set decoration',
  'set dec',
  'leadman',
  'leadperson',
  'on-set dresser',
  'on set dresser',
  // Props
  'props master',
  'prop master',
  'props coordinator',
  'prop coordinator',
  'props',
  // Locations
  'location manager',
  'location scout',
  'locations coordinator',
  'location coordinator',
  'assistant location manager',
  // Transpo
  'transportation coordinator',
  'transpo coordinator',
  'transpo captain',
  // Wardrobe / costume
  'wardrobe stylist',
  'wardrobe supervisor',
  'wardrobe',
  'costume designer',
  'costume supervisor',
  'stylist',
  // HMU
  'hmu',
  'hair stylist',
  'hair and makeup',
  'hair / makeup',
  'hair/makeup',
  'makeup artist',
  'make-up artist',
  'makeup',
  'make-up',
  'mua',
  'hair',
]

// Freemail / consumer-ISP domains. A sender at one of these is a
// PERSON, not a company — these domains must never produce a
// domain-based Company match or suggestion, anywhere (capture,
// person-history company ranking, quote prefill). A company whose
// billingEmail happens to be @gmail.com does NOT own gmail.com.
// Corporate domains keep normal domain-match behavior.
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'me.com',
  'mac.com',
  'protonmail.com',
  'proton.me',
  'msn.com',
  'live.com',
  'comcast.net',
  'verizon.net',
  'sbcglobal.net',
])

// Hard-skip vendor / service-provider domains. ANY sender on this
// list → SKIPPED before legitimacy tests run. Add domains here as
// false-positive captures surface — the AI signal can't reliably
// tell our own service vendors from production contacts when they
// happen to mention a company name.
//
// Seed list (2026-06-11 calibration findings):
//   - athosinsurance.com    — SirReel's insurance broker
//   - considine.com         — Considine & Considine CPA
export const KNOWN_VENDOR_DOMAINS: ReadonlySet<string> = new Set([
  'athosinsurance.com',
  'considine.com',
])

// Pattern matching SirReel's own company name in any reasonable
// spelling. When Haiku parses `parsedCompanyString` as us — usually
// because the sender's signature mentions SirReel in a thread reply
// or because a staff forward leaked the SirReel signature into the
// body — the capture is meaningless self-noise. Hard-skip these
// before legitimacy runs. 90 such captures surfaced in the 12-month
// backfill (most populous unmatched "company" string).
//
// Match is case-insensitive substring on the parsedCompanyString.
// Tight enough — "SirReel" is unique enough that any hit is us.
export const OWN_COMPANY_PATTERN = /sir\s?reel/i
