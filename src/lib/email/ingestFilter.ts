/**
 * Per-inbox ingest filter — decides whether an inbound message should
 * be persisted as an EmailMessage row (and therefore feed the AI
 * pipeline) or dropped on the floor. Dropped mail stays in Gmail —
 * Gmail itself is the authoritative archive of anything we don't pull
 * into the DB.
 *
 * Four modes:
 *
 *   CLAIMS    — claims@. Keep all inbound. The onboarding bridge
 *               (onboardFromEmail) is the actual classifier; this is
 *               the source for it.
 *
 *   MONEY     — billing@, payments@. POSITIVE-trigger filter: keep
 *               only mail with invoice/payment keywords or from known
 *               carrier/vendor/bank sender domains. Designed to
 *               surface AR/AP-actionable correspondence and drop
 *               everything else (newsletters, calendar invites, etc.).
 *
 *   SALES     — info@, jose@, oliver@, hello@, jobs@, studios@.
 *               NEGATIVE junk-filter: drop only the obvious noise
 *               (no-reply senders, calendar invites, DSN bounces,
 *               newsletter markers); keep everything else and let the
 *               downstream AI extractor decide if it's a lead. Bias
 *               STRONGLY inclusive — never drop a plausible human
 *               lead. The cost of an extra Haiku extraction is
 *               negligible compared to missing a quote opportunity.
 *
 *   PRESERVE  — ana@, dani@. No new filter; same behavior the system
 *               had before the filter shipped. ana@ is critical here
 *               because it's the claims-forward target; narrowing it
 *               would break the cross-inbox dedup contract we just
 *               wired up.
 *
 * Future inbox additions should pick a mode here BEFORE landing in
 * WATCHED_INBOXES, so nothing silently goes to "store everything" by
 * default. Inboxes not listed default to PRESERVE — same as today.
 *
 * Stats: every decision increments per-inbox counters
 * (IngestFilterStat). Use the GET endpoint at /api/email/ingest-stats
 * (TBD) or just `SELECT * FROM ingest_filter_stats` to tune.
 */

import { prisma } from '@/lib/prisma'
import type { RoutingHeaders } from '@/lib/email/routingHeaders'

export type InboxMode = 'SALES' | 'MONEY' | 'CLAIMS' | 'HR' | 'PRESERVE'

export const INBOX_MODES: Record<string, InboxMode> = {
  'claims@sirreel.com':   'CLAIMS',
  // HR mode is a routing mode, not a keep-all signal. The pubsub
  // handler short-circuits hr@ to the HR ingest branch BEFORE the
  // EmailMessage write path, so this mode's behavior is "structural
  // redirect" — the shouldIngest() switch below returns keep:false
  // (with reason: 'hr-redirect') for the safety belt: even if a
  // future code path forgets to short-circuit, the filter prevents
  // hr@ mail from ever landing in EmailMessage.
  'hr@sirreel.com':       'HR',
  'billing@sirreel.com':  'MONEY',
  'payments@sirreel.com': 'MONEY',
  'info@sirreel.com':     'SALES',
  'jose@sirreel.com':     'SALES',
  'oliver@sirreel.com':   'SALES',
  'hello@sirreel.com':    'SALES',
  'jobs@sirreel.com':     'SALES',
  'studios@sirreel.com':  'SALES',
  'ana@sirreel.com':      'PRESERVE',
  'dani@sirreel.com':     'PRESERVE',
}

export function inboxMode(inbox: string): InboxMode {
  return INBOX_MODES[inbox.toLowerCase()] ?? 'PRESERVE'
}

export interface FilterInput {
  inbox: string
  direction: 'INBOUND' | 'OUTBOUND'
  fromAddress: string
  subject: string
  bodyText: string | null
  bodyHtml: string | null
  routingHeaders: RoutingHeaders | null
}

export interface FilterDecision {
  keep: boolean
  reason: string
  mode: InboxMode
}

// ── Negative-filter patterns (SALES mode) ─────────────────────────

const NOREPLY_LOCALPART = /^(no[-_.]?reply|noreply|donotreply|do[-_.]?not[-_.]?reply|notifications?|alerts?|automated|auto[-_.]?reply|mailer[-_.]?daemon|postmaster|bounce|bounces|delivery|admin|root|news)@/i

// Calendar invites — Google Calendar's outbound + the standard subject
// prefixes any RFC 5545 ICS-bearing message uses. Both signals together
// are very precise; a human typing "invitation" in a subject won't fire
// the sender-based half.
const CALENDAR_SENDER_DOMAINS = [
  'calendar-notification@google.com',
  '@calendar.google.com',
  '@resource.calendar.google.com',
]
const CALENDAR_SUBJECT_RE = /^(invitation|updated invitation|canceled event|cancelled event|declined|accepted|tentative|re: invitation):/i

// Bounces / DSNs — RFC 3464 message subjects + the canonical
// mailer-daemon localparts. Belt-and-suspenders with NOREPLY_LOCALPART.
const BOUNCE_SUBJECT_RE = /(delivery status notification|mail delivery (?:failed|subsystem)|undelivered mail|returned mail|delivery has failed)/i

// Newsletter / marketing markers. The subject side is a curated list of
// common phrases that DON'T overlap with legitimate B2B inbound.
// "unsubscribe" alone isn't safe — humans say it. The full pattern
// "click here to unsubscribe" / "unsubscribe link" + a tracking-style
// preamble is what we want; combined-signal approach via body length.
const NEWSLETTER_SUBJECT_RE = /\b(newsletter|weekly digest|monthly (?:digest|recap|update)|trending now|in case you missed|join our|webinar|free trial|limited time|special offer)\b/i
const ESP_SENDER_DOMAINS = [
  '@mailchimp', '@mailchi.mp', '@sendgrid', '@sendinblue', '@hubspot',
  '@constantcontact.com', '@mailgun', '@mc.', '@email.', '@e.',
  '@news.', '@updates.', '@newsletter.', '@marketing.', '@hello.',
  '@notifications.', '@notify.', '@alerts.',
]

// ── Positive-filter patterns (MONEY mode) ─────────────────────────

const MONEY_KEYWORDS_RE = /\b(invoice|payment|remittance|ach|wire transfer|wire payment|deposit|balance due|statement|receipt|refund|charge|credit card|past[ -]due|outstanding|amount due|paid (?:in full|off)?|account receivable|accounts payable|net 30|net 45|net 60|w-?9|1099)\b/i

// Banks / processors / accounting tools. Match anywhere in the sender
// domain so subdomains count.
const MONEY_SENDER_HINTS = [
  // Banks
  'chase.com', 'wellsfargo.com', 'bankofamerica.com', 'citi.com', 'usbank.com',
  // Payment processors
  'stripe.com', 'square.com', 'paypal.com', 'authorize.net', 'cardpointe.com',
  // SaaS billing
  'quickbooks.intuit.com', 'intuit.com', 'bill.com', 'melio', 'plaid.com',
  // ACH / wire
  '@ach.', '@wire.', 'remittance',
]

// ── Helpers ─────────────────────────────────────────────────────

function lc(s: string | null | undefined): string {
  return (s ?? '').toLowerCase()
}

// Extract just the email portion ("Foo <bar@baz>" → "bar@baz").
function bareEmail(fromAddress: string): string {
  const m = fromAddress.match(/<([^>]+)>/)
  return (m ? m[1] : fromAddress).trim().toLowerCase()
}

function senderHintsMatch(fromAddress: string, hints: string[]): boolean {
  const bare = bareEmail(fromAddress)
  return hints.some((h) => bare.includes(h))
}

// ── Per-mode evaluators ─────────────────────────────────────────

function evaluateSales(input: FilterInput): FilterDecision {
  const from = lc(input.fromAddress)
  const subj = lc(input.subject)
  const bare = bareEmail(input.fromAddress)
  const body = lc(input.bodyText ?? input.bodyHtml ?? '')

  // 1. No-reply / automated senders.
  if (NOREPLY_LOCALPART.test(bare)) {
    return { keep: false, reason: 'noreply-sender', mode: 'SALES' }
  }

  // 2. Calendar invites.
  if (CALENDAR_SENDER_DOMAINS.some((d) => from.includes(d))) {
    return { keep: false, reason: 'calendar-invite', mode: 'SALES' }
  }
  if (CALENDAR_SUBJECT_RE.test(input.subject)) {
    return { keep: false, reason: 'calendar-invite', mode: 'SALES' }
  }

  // 3. Bounces / DSNs.
  if (BOUNCE_SUBJECT_RE.test(input.subject)) {
    return { keep: false, reason: 'bounce', mode: 'SALES' }
  }

  // 4. Newsletter / marketing. Subject-side rule fires fast; body-side
  // requires the email to be long enough that it's clearly a campaign
  // (a human writing "unsubscribe me" in a 200-char message doesn't
  // hit this).
  if (NEWSLETTER_SUBJECT_RE.test(input.subject)) {
    return { keep: false, reason: 'newsletter-subject', mode: 'SALES' }
  }
  if (ESP_SENDER_DOMAINS.some((d) => from.includes(d))) {
    return { keep: false, reason: 'esp-sender', mode: 'SALES' }
  }
  if (body.length > 2048 && body.includes('unsubscribe') && body.includes('view this email')) {
    return { keep: false, reason: 'newsletter-body', mode: 'SALES' }
  }

  // 5. Otherwise → KEEP. Bias inclusive; AI extractor decides if it's
  // a real lead.
  return { keep: true, reason: 'sales-human', mode: 'SALES' }
}

function evaluateMoney(input: FilterInput): FilterDecision {
  const subj = input.subject
  const body = input.bodyText ?? input.bodyHtml ?? ''
  // Cap the keyword scan at the first 8KB of body — payment-related
  // emails always declare their nature in the opening lines, and we
  // shouldn't burn cycles scanning a multi-megabyte attachment-rich
  // body for "invoice".
  const bodySnippet = body.slice(0, 8192)

  if (MONEY_KEYWORDS_RE.test(subj) || MONEY_KEYWORDS_RE.test(bodySnippet)) {
    return { keep: true, reason: 'money-keyword', mode: 'MONEY' }
  }
  if (senderHintsMatch(input.fromAddress, MONEY_SENDER_HINTS)) {
    return { keep: true, reason: 'money-sender', mode: 'MONEY' }
  }
  return { keep: false, reason: 'money-no-trigger', mode: 'MONEY' }
}

/**
 * Decide whether to ingest. Outbound mail (any direction === 'OUTBOUND')
 * is ALWAYS kept — outbound rows drive thread direction state and the
 * reply classifier, and silently dropping them would break the cadence
 * surface. The filter only operates on inbound.
 */
export function shouldIngest(input: FilterInput): FilterDecision {
  const mode = inboxMode(input.inbox)
  // HR is structurally redirected at the pubsub handler — hr@ mail
  // writes to HrEmail, NOT EmailMessage. Returning keep:false here
  // is a SAFETY BELT: even if a future code path forgets the short-
  // circuit, the filter still prevents hr@ mail from ever landing
  // in EmailMessage. Outbound HR mail (the rare case of replying
  // FROM hr@ via send-as) is also blocked from the standard email
  // table; if we want a thread view for outbound HR replies the HR
  // pipeline will store them in HrEmail too.
  if (mode === 'HR') {
    return { keep: false, reason: 'hr-redirect', mode }
  }
  if (input.direction === 'OUTBOUND') {
    return { keep: true, reason: 'outbound', mode }
  }
  // HR is already returned above; the narrowed switch is exhaustive
  // over the remaining union members.
  switch (mode) {
    case 'CLAIMS':   return { keep: true, reason: 'claims-all', mode }
    case 'PRESERVE': return { keep: true, reason: 'preserve', mode }
    case 'MONEY':    return evaluateMoney(input)
    case 'SALES':    return evaluateSales(input)
  }
}

/**
 * Increment the per-inbox counter for this decision. Fire-and-forget;
 * never blocks the ingest path. A failed stat write is logged + ignored
 * — stats are an observability concern, not the ingest contract.
 */
export async function recordIngestDecision(
  inbox: string,
  decision: FilterDecision,
): Promise<void> {
  try {
    const now = new Date()
    await prisma.ingestFilterStat.upsert({
      where: { inbox },
      create: {
        inbox,
        mode: decision.mode,
        kept: decision.keep ? 1 : 0,
        dropped: decision.keep ? 0 : 1,
        lastDropReason: decision.keep ? null : decision.reason,
        lastDropAt:     decision.keep ? null : now,
        lastKeptAt:     decision.keep ? now  : null,
      },
      update: {
        mode: decision.mode,
        kept:    decision.keep ? { increment: 1 } : undefined,
        dropped: decision.keep ? undefined        : { increment: 1 },
        lastDropReason: decision.keep ? undefined : decision.reason,
        lastDropAt:     decision.keep ? undefined : now,
        lastKeptAt:     decision.keep ? now       : undefined,
      },
    })
  } catch (err) {
    console.warn('[ingestFilter] stat write failed for', inbox, err instanceof Error ? err.message : err)
  }
}
