/**
 * Exec / Coverage dashboard — single source of truth for cadence
 * thresholds. Every coverage card reads from this module so the
 * "what counts as stale / overdue / nearing-expiry" definitions live
 * in one place and stay consistent between the API filters and the
 * UI copy.
 *
 * Tuning happens here, NOT inline in endpoints or components. If a
 * threshold changes, the card label, the API filter, and any triage
 * roll-up math all pick it up from the same constant.
 *
 * All durations are integer days unless the name says otherwise.
 */

/**
 * Deals (Order rows in QUOTE_SENT / DRAFT lanes) whose updatedAt is
 * older than this many *business* days are flagged "stale" in Card B.
 * Business-day math is the caller's responsibility — this constant
 * is the threshold count, not a calendar-day shortcut. Five business
 * days ≈ one full work week of silence.
 */
export const STALE_DEAL_BUSINESS_DAYS = 5

/**
 * An Order that has line items but has been sitting in DRAFT for
 * longer than this gets flagged as "drafted but never sent" — Card B
 * surfaces these so coverage can ping the agent before the deal goes
 * cold. Calendar days; the agent has a full weekend's grace.
 */
export const UNSENT_DRAFT_DAYS = 2

/**
 * Quotes whose Order.expiresAt is within this many days of "now"
 * surface as "nearing expiry" in Card B — the coverage owner can
 * either escalate to follow-up or extend the window before the
 * quote auto-expires.
 */
export const QUOTE_EXPIRY_WARNING_DAYS = 3

/**
 * Window (in days) for surfacing Company.annualAgreementExpiresAt /
 * annualCoiExpiresAt renewals in Card A. A renewal lands in the
 * approvals queue once it's within this many days of expiring, OR
 * once it's already expired (negative delta).
 */
export const RENEWAL_WINDOW_DAYS = 30
