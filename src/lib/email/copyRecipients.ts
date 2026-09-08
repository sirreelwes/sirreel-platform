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
  // The GROUP, not the individuals. This listed jose@ + oliver@ until
  // 2026-09-08; both are in the rentals@ group, so naming them here sent
  // duplicates and, worse, silently excluded anyone added to the desk
  // since. A default that has to be edited when the team changes is a
  // default that will be wrong (Wes: "Oliver is in rentals@ group so no
  // need for extra cc"). Overrides at /admin/notifications still win.
  sales: ['rentals@sirreel.com'],
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

/**
 * Wes's own mailbox — the one address that stays on EVERYTHING.
 *
 * Wes 2026-09-08: "no one gets anything but absolutely necessary emails.
 * Wes wants to continue getting all HQ emails, but the guys don't need
 * them." So the awareness-tier channels in notificationChannels.ts
 * resolve here instead of to the hq@ group, which fanned every FYI out
 * to Jose and Oliver as well.
 *
 * A function and env-overridable for the same reason as hqNotifyInbox():
 * read at call time, and a staging deploy can point it somewhere else
 * rather than mailing the owner on every test send.
 */
export function ownerNotifyInbox(): string {
  return process.env.OWNER_NOTIFY_INBOX || 'wes@sirreel.com'
}
