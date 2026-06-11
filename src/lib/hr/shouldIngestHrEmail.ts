/**
 * Single source of truth for "should this message land in the HR
 * pipeline?" Mirror of src/lib/claims/shouldOnboardClaimEmail.ts.
 *
 * Two acceptance paths:
 *
 *   A. Direct-polled inbox is hr@. Reserved for if/when hr@ becomes
 *      a real Workspace user mailbox and DWD can impersonate it. As
 *      of 2026-06-11 this fails — hr@ is configured as a Google
 *      Group / alias that forwards into another mailbox (dani@).
 *
 *   B. The polled inbox is something else, BUT the routing headers
 *      show the message was originally addressed to hr@ (anywhere in
 *      To / Cc / Delivered-To / X-Original-To / X-Forwarded-For /
 *      X-Forwarded-To). This is the live path today: hr@-addressed
 *      mail is forwarded by the alias into dani@, Pub/Sub fires for
 *      dani@, we read deliveredTo + cousin headers and route the
 *      message to the HR pipeline before it ever hits EmailMessage.
 *
 * Authorship exclusion (both paths): From: is NOT hr@ itself —
 * skips Wes/Dani replying through a send-as alias which would
 * otherwise loop.
 */

import { routingHeadersContain, type RoutingHeaders } from '@/lib/email/routingHeaders'

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
  /** Routing headers from the message. Optional — when missing, only
   *  the direct-inbox path can match. When present, the routing-header
   *  path also matches. */
  routingHeaders?: RoutingHeaders | null
}

export function shouldIngestHrEmail(input: HrIngestGateInput): boolean {
  if (bareEmail(input.fromAddress) === HR_INBOX) return false
  // Path A — direct DWD impersonation of hr@.
  if (input.inbox.toLowerCase() === HR_INBOX) return true
  // Path B — routing-header detection on a forwarded copy. Any of the
  // captured headers containing hr@sirreel.com is sufficient.
  if (input.routingHeaders && routingHeadersContain(input.routingHeaders, HR_INBOX)) return true
  return false
}
