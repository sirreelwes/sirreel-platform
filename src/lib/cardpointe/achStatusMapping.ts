/**
 * CardPointe eCheck status → SirReel PaymentStatus mapping.
 *
 * THIS IS THE ONE PLACE WE DECIDE "the gateway says it cleared."
 * Anywhere else in the codebase wanting to know whether to advance
 * or reverse a PENDING ACH payment MUST go through mapAchInquireToPaymentState.
 * Do not inline gateway-status reads in the polling job, in routes,
 * or anywhere else. Single chokepoint.
 *
 * ─────────────────────────────────────────────────────────────────
 * STATUS — UNVERIFIED. KEEP PAYMENTS PENDING UNTIL UNDERWRITING
 *           HANDS US THE EXACT eCHECK SETTLEMENT-STATUS VALUES.
 * ─────────────────────────────────────────────────────────────────
 *
 * I do not have CardPointe's confirmed eCheck settlement status
 * vocabulary in this repo (no API docs committed; CardConnect's
 * /inquire/ endpoint returns a `setlstat` whose values I have NOT
 * verified end-to-end for ACH against their published list). The
 * card-side card_status values map fairly cleanly (Authorized,
 * Captured, Voided), but ACH has its own lifecycle with terminology
 * that differs across CardConnect documentation versions and
 * across UAT vs. prod gateways.
 *
 * Likely-but-unverified values for ACH from publicly-referenced
 * CardConnect snippets:
 *   "Authorized"             — accepted into ACH origination queue
 *   "Pending Settlement"     — submitted to the ACH network
 *   "Settled"                — funds posted, awaiting clearing-period close
 *   "Cleared" / "Funded"     — clearing window passed, money is ours
 *   "Returned"               — bank rejected (NSF, closed account, etc.)
 *   "Rejected" / "Declined"  — gateway-level refusal before ACH submit
 *
 * NEVER MAP TO CLEARED ON AN UNVERIFIED STATUS STRING. The financial
 * cost of a false-positive CLEARED is real: it advances the order to
 * CLOSED, fires "your order is closed" copy at the client, and may
 * close a deal whose funds the bank later claws back. The cost of a
 * false-negative (keeping a truly-cleared payment in PENDING) is
 * mild: the polling job catches it on the next tick, or an operator
 * manually marks it.
 *
 * TODO: verify against CardPointe eCheck settlement statuses before
 * go-live. Replace the AMBIGUOUS branch with an exhaustive switch
 * over the documented `setlstat` values once the rep confirms them.
 * When that happens, this file should be the ONLY change required.
 */

import type { PaymentStatus } from '@prisma/client'

/**
 * The minimal slice of a CardPointe /inquire/ response that the
 * mapper reads. Matches the shape returned by
 * src/lib/cardpointe/client.ts inquireByRetref().
 */
export interface AchInquireSnapshot {
  /** Settlement status string from the gateway. Vocabulary unverified
   *  for ACH — see file header. May be undefined when the gateway
   *  omits it (e.g. for retrefs the gateway doesn't recognize). */
  setlstat?: string
  /** ACH return code, when present. Indicates NSF / closed-account /
   *  authorization-revoked / etc. Any non-empty value is treated as
   *  a return signal. */
  bankret?: string
  /** Human-readable response text. Logged on transition decisions
   *  so an operator can audit why a payment moved or didn't. */
  resptext?: string
}

export type AchTargetState = 'PENDING' | 'SETTLED' | 'CLEARED' | 'RETURNED' | 'FAILED'

export interface AchMappingResult {
  /** Where the polling job should move the payment to. PENDING means
   *  "keep it where it is; check again next tick." */
  target: AchTargetState
  /** Short stable reason code for the audit log. Not a user-facing
   *  string. */
  reason: string
  /** Whether this decision was confident (mapped from a verified
   *  status) or conservative (defaulted to PENDING because the
   *  status string isn't in the verified vocabulary). Used by the
   *  polling job to choose between "log and continue" vs "log and
   *  flag for operator review." */
  confidence: 'verified' | 'unverified'
}

/**
 * Decides what state a PENDING/SETTLED ACH payment should move to,
 * given a fresh /inquire/ snapshot from the gateway.
 *
 * RULES:
 *   1. Any non-empty bankret is a return — RETURNED, regardless of
 *      setlstat. The bank's return-reason code is the authoritative
 *      signal that the debit was reversed.
 *   2. After (1), evaluate setlstat. Until the vocabulary is
 *      verified, treat ALL setlstat values as ambiguous and return
 *      PENDING. Operator (or a follow-up tick) reconciles.
 *   3. When the vocabulary IS verified, replace the ambiguous
 *      switch with an exhaustive map. Confidence flips to
 *      'verified' on every branch.
 */
export function mapAchInquireToPaymentState(snap: AchInquireSnapshot): AchMappingResult {
  // (1) Return-code path — bankret is the most reliable signal we
  // have. Any value present means the ACH was returned. Empty
  // string / undefined = no return.
  if (snap.bankret && snap.bankret.trim().length > 0) {
    return {
      target: 'RETURNED',
      reason: `bank_return:${snap.bankret.trim().slice(0, 32)}`,
      confidence: 'verified',
    }
  }

  // (2) Settlement-status path — UNVERIFIED. Keep PENDING until the
  // CardPointe eCheck settlement vocabulary is confirmed by the rep
  // and this switch is filled in. The polling job advances PENDING
  // payments forward; a stuck PENDING gets re-polled on the next
  // tick. There is no cost to over-polling, real cost to over-
  // advancing.
  const stat = (snap.setlstat ?? '').trim()
  if (!stat) {
    return {
      target: 'PENDING',
      reason: 'no_setlstat_in_response',
      confidence: 'unverified',
    }
  }

  // TODO: verify against CardPointe eCheck settlement statuses before
  // go-live. Replace this whole block with an exhaustive switch
  // mapping the documented setlstat vocabulary to:
  //
  //   Authorized / In Origination / Pending Settlement     → SETTLED
  //   Settled / Funded / Cleared                          → CLEARED
  //   Rejected / Declined / NSF / Returned / Voided       → FAILED or RETURNED
  //   anything else                                        → PENDING (and log)
  //
  // Until then we surface the actual gateway string in the audit
  // trail and keep the payment PENDING so the next poll re-checks.
  return {
    target: 'PENDING',
    reason: `unverified_setlstat:${stat.slice(0, 64)}`,
    confidence: 'unverified',
  }
}
