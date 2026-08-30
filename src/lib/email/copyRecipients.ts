/**
 * Internal copy-recipient roster for signed-contract notifications.
 *
 * Single source — extracted from /api/portal/[token]/agreement/sign
 * (rental flow) so the stage-contract flow and any future signing
 * surface share one list instead of duplicating addresses.
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

/** Flat internal roster (sales + billing) for TO/CC lines. */
export function internalCopyRecipients(): string[] {
  return [...COPY_RECIPIENTS.sales, ...COPY_RECIPIENTS.billing]
}
