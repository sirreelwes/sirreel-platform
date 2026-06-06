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
]

export function isWatchedInbox(email: string): boolean {
  return WATCHED_INBOXES.includes(email.toLowerCase())
}
