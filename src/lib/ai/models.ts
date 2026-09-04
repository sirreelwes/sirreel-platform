/**
 * Central Anthropic model constants — the ONLY place model ID strings
 * live. Call sites import by PURPOSE so a model bump is a one-line
 * change here, per tier, instead of a grep across the repo.
 *
 * Values are preserved verbatim from each call site (pure refactor,
 * zero behavior change). Known inconsistencies kept as-is pending a
 * decision:
 *  - PARSING_MODEL (sonnet-4-5) vs INTAKE_PARSING_MODEL (sonnet-4-6):
 *    similar extraction work on different generations.
 */

/** Orders/document parsing → structured JSON: quote parse, PDF text extraction, claim-document classification. */
export const PARSING_MODEL = 'claude-sonnet-4-5-20250929'

/** Newer-generation intake parsing: hr@ email triage, pasted claim-email chains. */
export const INTAKE_PARSING_MODEL = 'claude-sonnet-4-6'

/** Compliance & contract review: COI check/review, WC review, contract redline, contract runReview, portal job COI, quick-reply AI review. */
export const REVIEW_MODEL = 'claude-sonnet-4-5-20250929'

/** Inbound reply classification for the cadence engine. */
export const REPLY_CLASSIFIER_MODEL = 'claude-sonnet-4-5'

/** Interactive fleet assistant chat. */
export const ASSISTANT_MODEL = 'claude-sonnet-4-5-20250929'

/** Client-email drafting behind the composers' "Suggest with AI" button. */
export const EMAIL_SUGGEST_MODEL = 'claude-sonnet-4-5-20250929'

/** Long-form document drafting (demand letters). */
export const DRAFTING_MODEL = 'claude-sonnet-4-5-20250929'

/** Cheap one-line email summaries (gmail sync, summary backfill). */
export const SUMMARY_MODEL = 'claude-haiku-4-5-20251001'

/** Cheap per-message structured extraction (Pipeline Quick Read cards). */
export const MESSAGE_EXTRACTION_MODEL = 'claude-haiku-4-5-20251001'

/**
 * Judging whether an aging RentalWorks invoice has already been paid, from its
 * email trail (/collections/rw-review). Opus rather than the review tier used
 * elsewhere: this reads a scrappy, contradictory thread — a promise to pay, a
 * disputed line item, an attached wire confirmation — and the failure mode is
 * asymmetric. Calling a paid invoice open wastes a phone call; calling an open
 * one paid stops the chase on real money. Runs over ~90 invoices on demand,
 * not per request, so the tier costs little.
 */
export const COLLECTIONS_EVIDENCE_MODEL = 'claude-opus-5'

/**
 * Reading a client's redline out of whatever they actually sent — an
 * email, a pasted list of edits, a screenshot of a marked-up page — and
 * returning the FULL amended text of each numbered clause.
 *
 * Opus rather than the review tier, for the same asymmetry that put
 * collections on Opus: the output is the literal contract language the
 * client is asked to sign. A summary where a clause should be, or a
 * silently dropped strike, reaches a signature. The operator reviews
 * every clause before saving, but the model's job is to hand them the
 * real text, not a draft to reconstruct. Runs once per redline.
 */
export const REDLINE_EXTRACTION_MODEL = 'claude-opus-5'

/** Minimal-cost API health probe. */
export const HEALTH_CHECK_MODEL = 'claude-haiku-4-5-20251001'
