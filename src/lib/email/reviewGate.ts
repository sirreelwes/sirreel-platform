/**
 * Universal review-before-send gate registry.
 *
 * Every entry is currently `true` — all agent-initiated client emails
 * route through <EmailReviewModal>. To later auto-send a specific
 * email type without the preview step:
 *
 *   1. Flip the entry below to `false`.
 *   2. Grep for `shouldReview('<kind>')` and update each trigger to
 *      call the send endpoint directly in the `else` branch.
 *
 * Centralizing the config here means future-Wes flips one constant
 * and the lift surface is locatable by grep alone. Today's components
 * call `shouldReview()` as documentation of the gate — they always
 * open the modal because every flag is true.
 *
 * Imported types: EmailReviewModal's target.kind discriminator. If a
 * new email type is added to that discriminator, TypeScript will fail
 * on this Record until an entry is added — the gate is mandatory for
 * any new agent-initiated client email.
 */

import type { EmailReviewTarget } from '@/components/email/EmailReviewModal'

type EmailReviewKind = EmailReviewTarget['kind']

const REVIEW_REQUIRED: Record<EmailReviewKind, boolean> = {
  quote: true,
  'followup-order': true,
  'followup-job': true,
}

export function shouldReview(kind: EmailReviewKind): boolean {
  return REVIEW_REQUIRED[kind]
}
