/**
 * Central Anthropic model constants — the ONLY place model ID strings
 * live. Call sites import by PURPOSE so a model bump is a one-line
 * change here, per tier, instead of a grep across the repo.
 *
 * Values are preserved verbatim from each call site (pure refactor,
 * zero behavior change). Known inconsistencies kept as-is pending a
 * decision:
 *  - REVIEW_MODEL vs REVIEW_MODEL_UNPINNED: same purpose class, but two
 *    pin styles. The 'claude-sonnet-4-5' alias resolves to the same
 *    20250929 snapshot today, so they're currently the same model.
 *  - PARSING_MODEL (sonnet-4-5) vs INTAKE_PARSING_MODEL (sonnet-4-6):
 *    similar extraction work on different generations.
 */

/** Orders/document parsing → structured JSON: quote parse, PDF text extraction, claim-document classification. */
export const PARSING_MODEL = 'claude-sonnet-4-5-20250929'

/** Newer-generation intake parsing: hr@ email triage, pasted claim-email chains. */
export const INTAKE_PARSING_MODEL = 'claude-sonnet-4-6'

/** Compliance & contract review: COI check/review, WC review, contract redline, quick-reply AI review. */
export const REVIEW_MODEL = 'claude-sonnet-4-5-20250929'

/** Same review tier via the undated alias (contract runReview, portal job COI). */
export const REVIEW_MODEL_UNPINNED = 'claude-sonnet-4-5'

/** Inbound reply classification for the cadence engine. */
export const REPLY_CLASSIFIER_MODEL = 'claude-sonnet-4-5'

/** Interactive fleet assistant chat. */
export const ASSISTANT_MODEL = 'claude-sonnet-4-5-20250929'

/** Long-form document drafting (demand letters). */
export const DRAFTING_MODEL = 'claude-sonnet-4-5-20250929'

/** Cheap one-line email summaries (gmail sync, summary backfill). */
export const SUMMARY_MODEL = 'claude-haiku-4-5-20251001'

/** Cheap per-message structured extraction (Pipeline Quick Read cards). */
export const MESSAGE_EXTRACTION_MODEL = 'claude-haiku-4-5-20251001'

/** Minimal-cost API health probe. */
export const HEALTH_CHECK_MODEL = 'claude-haiku-4-5-20251001'
