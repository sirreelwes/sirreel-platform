/**
 * Single source of truth for "should this message fire the claims@
 * onboarding bridge?" Used by all three Gmail ingest paths (pubsub /
 * sync / fetch) so the contract can't drift.
 *
 * Gate: the message must have landed in the claims@ inbox AND not be
 * authored by claims@ itself. Two real-world cases this covers:
 *
 *   1. Adjuster → claims@. A carrier-side adjuster mails the SirReel
 *      claims address directly. Direction === 'INBOUND' under the
 *      existing classifier.
 *
 *   2. SirReel staff forward → claims@. Wes/Dani/Ana receive a
 *      customer or carrier email on their own inbox and forward it
 *      INTO claims@ so the onboarding pipeline can ingest it.
 *      getMessageDirection() tags this 'OUTBOUND' because the From:
 *      header is a SirReel agent — the prior INBOUND-only gate
 *      silently swallowed these. Re-gating on AUTHORSHIP (not
 *      direction) catches both cases without an exception list of
 *      who can forward.
 *
 * Exclusion: messages authored by claims@ itself (Ana's own outgoing
 * replies through the send-as alias). Without this we'd loop on
 * every reply Ana sends out from claims@.
 */

export const CLAIMS_INBOX = 'claims@sirreel.com'

// Bare "<addr>" extraction from RFC-2822 From-style values like
// '"SirReel Claims" <claims@sirreel.com>'. Identical normalization
// to the rest of the email pipeline so the comparison stays
// consistent.
function bareEmail(fromAddress: string): string {
  const m = fromAddress.match(/<([^>]+)>/)
  return (m ? m[1] : fromAddress).trim().toLowerCase()
}

export interface OnboardGateInput {
  /** The polled inbox the message landed in (EmailAccount.emailAddress). */
  inbox: string
  /** The raw From: header. */
  fromAddress: string
}

export function shouldOnboardClaimEmail(input: OnboardGateInput): boolean {
  if (input.inbox.toLowerCase() !== CLAIMS_INBOX) return false
  if (bareEmail(input.fromAddress) === CLAIMS_INBOX) return false
  return true
}
