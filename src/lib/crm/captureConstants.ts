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
export const PRODUCTION_TITLE_TOKENS: readonly string[] = [
  'producer',
  'production manager',
  'production coordinator',
  'production supervisor',
  'production assistant',
  'upm',
  'unit production manager',
  'line producer',
  'executive producer',
  'transportation coordinator',
  'transpo coordinator',
  'transpo captain',
  'location manager',
  'location scout',
  'art director',
  'art coordinator',
  'production designer',
  'gaffer',
  'key grip',
  'best boy',
  'dp ',
  'director of photography',
  'cinematographer',
  '1st ad',
  '2nd ad',
  'assistant director',
  'showrunner',
  'producer/director',
  'co-producer',
  'co producer',
  'segment producer',
  'field producer',
  'commercial producer',
]
