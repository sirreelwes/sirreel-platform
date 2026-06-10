/**
 * Single source of truth for "should this message land in the HR
 * pipeline?" Mirror of src/lib/claims/shouldOnboardClaimEmail.ts.
 *
 * Gate: inbox is hr@sirreel.com AND From: is NOT hr@sirreel.com
 * itself. Covers two real-world cases:
 *
 *   1. Direct → hr@. Payroll provider, benefits broker, insurance
 *      adjuster on a worker's-comp claim, ADP / TriNet / Justworks.
 *   2. Staff forward → hr@. Wes or Dani receives a complaint /
 *      doctor's note / leave request on their own inbox and
 *      forwards INTO hr@. getMessageDirection() tags this OUTBOUND
 *      because the From: is a SirReel agent — same authorship-not-
 *      direction gate the claims pipeline uses (see claims/d89328e
 *      for the original learning).
 *
 * Exclusion: outbound replies from hr@ itself (Wes/Dani replying
 * through a send-as alias). Without this we'd loop on every reply.
 */

export const HR_INBOX = 'hr@sirreel.com'

function bareEmail(fromAddress: string): string {
  const m = fromAddress.match(/<([^>]+)>/)
  return (m ? m[1] : fromAddress).trim().toLowerCase()
}

export interface HrIngestGateInput {
  /** The polled inbox the Pub/Sub notification fired for. */
  inbox: string
  /** Raw From: header value. */
  fromAddress: string
}

export function shouldIngestHrEmail(input: HrIngestGateInput): boolean {
  if (input.inbox.toLowerCase() !== HR_INBOX) return false
  if (bareEmail(input.fromAddress) === HR_INBOX) return false
  return true
}
