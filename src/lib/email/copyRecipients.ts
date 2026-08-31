/**
 * Built-in DEFAULT internal copy rosters.
 *
 * Since 2026-08-31 these are no longer read directly by any send path —
 * they are the fallback defaults for the notification channels
 * ('signed-contract-sales' / 'signed-contract-billing' / 'hq-documents')
 * in src/lib/email/notificationChannels.ts, which /admin/notifications
 * can override per channel. Edit recipients THERE, not here; this file
 * only defines what applies when no override row exists.
 */
export const COPY_RECIPIENTS = {
  sales: ['jose@sirreel.com', 'oliver@sirreel.com'],
  billing: ['ana@sirreel.com'],
} as const

/**
 * The hq@ distribution group — outbound-only (wes/jose/oliver), nobody
 * works out of it. Env-overridable so staging never mails the real team.
 *
 * A function, not a const: the value is read at call time so a route
 * module loaded before the env is populated still resolves correctly.
 */
export function hqNotifyInbox(): string {
  return process.env.HQ_NOTIFY_INBOX || 'hq@sirreel.com'
}
