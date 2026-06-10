/**
 * Centralized list of SirReel mailboxes the Gmail-ingest pipeline
 * watches + pulls history for. Single source of truth — was
 * duplicated across four route files (pubsub / sync / fetch /
 * watch), which caused the dani@ vs claims@ drift the inbox audit
 * caught. All four routes now import from here.
 *
 * Adding a new address checklist (DON'T just push and hope):
 *   1. Confirm it's a real Workspace USER mailbox via
 *      GET /api/gmail/probe?email=<addr>. Groups / aliases throw
 *      on the DWD JWT path and silently break ingest.
 *   2. Add the lowercase address to WATCHED_INBOXES below.
 *   3. The daily watch cron (vercel.json) re-arms watches on
 *      every run at 06:00 UTC, so the new mailbox starts
 *      receiving Pub/Sub deliveries on the next tick. Trigger
 *      manually via POST /api/gmail/watch to start sooner.
 *
 * Dedup contract for Ana-managed inboxes (billing/payments/jobs/
 * studios/hello, also claims). Several of these forward into ana@
 * for Ana's day-to-day workflow. The pubsub handler already dedups
 * by rfc822MessageId — when the same Message-ID arrives in N
 * watched inboxes, the OLDEST createdAt becomes canonical and the
 * rest are tagged `duplicateOfId`. Going forward this means: when a
 * billing@-addressed message lands in billing@ first and is then
 * forwarded into ana@, billing@'s row is canonical and ana@'s copy
 * is the duplicate — which is what reports want. For per-inbox
 * activity views (e.g. "how much mail is billing@ getting?"), do
 * NOT count ana@'s mirrored copies — filter on
 * `routing_headers->>'deliveredTo' = '<inbox>@sirreel.com'`
 * (populated by extractRoutingHeaders at ingest), which is robust
 * regardless of which copy ended up canonical.
 */

export const WATCHED_INBOXES: readonly string[] = [
  'info@sirreel.com',
  'jose@sirreel.com',
  'oliver@sirreel.com',
  'ana@sirreel.com',
  // Added 2026-06-06 — both DWD-impersonability-confirmed via the
  // /api/gmail/probe endpoint before landing here. claims@ is the
  // foundation for the claim-correspondence matcher; dani@ catches
  // the COO surface that was previously not ingested despite
  // appearing in the legacy diagnostic /api/gmail search-only path.
  'claims@sirreel.com',
  'dani@sirreel.com',
  // Added 2026-06-07 — five operational Ana-managed mailboxes.
  // All five DWD-impersonability-confirmed (probe returned
  // messagesTotal in the 14k-116k range) — none are aliases.
  // studios@: studio-relationship inbox.
  // jobs@:    paperwork (job sheets, contracts, COIs).
  // hello@:   first-touch / general inbound — heaviest mailbox.
  // payments@:incoming payment notifications + remittance.
  // billing@: AR-side billing correspondence (Ana's primary inbox).
  // Several of these forward into ana@ — see the "Dedup contract"
  // note above for the correct way to count per-inbox activity.
  'studios@sirreel.com',
  'jobs@sirreel.com',
  'hello@sirreel.com',
  'payments@sirreel.com',
  'billing@sirreel.com',
  // Added 2026-06-10 — HR pipeline. IMPORTANT: hr@ is in a separate
  // structural partition. The pubsub handler short-circuits hr@ at
  // the source so its mail writes to HrEmail (not EmailMessage), and
  // the ingest filter has HR mode that returns keep:false for any
  // EmailMessage write attempt as a safety belt. Listed here so the
  // daily Gmail watch cron renews push notifications for the inbox
  // (the watch is what makes hr@ deliver pub/sub events in the first
  // place). DWD impersonability confirmed by Wes.
  'hr@sirreel.com',
]

export function isWatchedInbox(email: string): boolean {
  return WATCHED_INBOXES.includes(email.toLowerCase())
}
