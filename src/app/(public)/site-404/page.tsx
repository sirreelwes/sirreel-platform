import { notFound } from 'next/navigation'

/**
 * Rewrite target for the middleware's catch-all on the marketing and orders
 * hosts. Exists only to call notFound(), which renders (public)/not-found.tsx
 * inside the public shell AND sets a real 404 status.
 *
 * Why a trigger route instead of returning HTML from the middleware: the
 * middleware runs on the edge with no access to the React tree, so a branded
 * response there would mean duplicating the nav, footer, and fonts as a string
 * — guaranteed to drift. Rewriting keeps one 404 design.
 *
 * Why not rewrite straight to a non-existent path: that renders the framework
 * 404, not ours, because there is no page to resolve the segment.
 *
 * Reaching /site-404 directly just renders the 404 page, which is correct.
 * Crawlers get a 404 status here, so it never lands in an index.
 */

export const dynamic = 'force-dynamic'

export default function Site404Trigger(): never {
  notFound()
}
