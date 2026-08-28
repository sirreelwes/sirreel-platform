/**
 * Shared constants for bulk outreach logging.
 *
 * MAX_TARGETS lives here rather than in the route because a Next.js
 * route file may only export the HTTP handlers and the framework's own
 * config keys (`dynamic`, `revalidate`, …). A stray `export const
 * MAX_TARGETS` there type-checks fine under `tsc --noEmit` and then
 * fails `next build` with "does not match the required types of a
 * Next.js Route" — which is exactly how it reached production on
 * 2026-08-28 and went red.
 *
 * Keeping it in a lib module also lets the UI state the real cap instead
 * of hardcoding a second copy of the number.
 */

/**
 * Most contacts one bulk outreach log may target.
 *
 * A rep did not personally meet 600 people. A request that large is a
 * select-all misfire, and honouring it would put a fabricated touch on
 * every one of those timelines.
 */
export const BULK_OUTREACH_MAX_TARGETS = 500
