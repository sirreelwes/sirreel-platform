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

/** Flat internal roster (sales + billing) for TO/CC lines. */
export function internalCopyRecipients(): string[] {
  return [...COPY_RECIPIENTS.sales, ...COPY_RECIPIENTS.billing]
}
